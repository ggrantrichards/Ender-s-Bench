// The schema name can reach the model on some providers, so current runs use a neutral one. The archived v4
// checkpoint generators pass ARCHIVED_SCHEMA_NAME so their datasets still reproduce byte for byte.
export const ARCHIVED_SCHEMA_NAME = 'breakwater_response';
export function responseSchema(properties, name = 'response') {
  return { type: 'json_schema', json_schema: { name, strict: true,
    schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } } };
}

// apiKey overrides ENDERS_BENCH_API_KEY, so one run can call judges on different providers.
// ENDERS_BENCH_RETRY_MINUTES > 0 keeps retrying when the server is down or returns 5xx (a crashed or restarting
// local server) instead of failing the run. Default 0: fail on the first error, as before.
export async function requestModel(endpoint, request, options = {}) {
  const deadline = Date.now() + 60_000 * Number(process.env.ENDERS_BENCH_RETRY_MINUTES || 0);
  for (;;) {
    try {
      const response = await requestOnce(endpoint, request, options);
      // A thinking model can spend the whole token budget reasoning and return no answer. Retry once with room to
      // finish, so runners written for ordinary models (small max_tokens) still work with one.
      // Hosted thinking models (Gemini 2.5, for one) count hidden reasoning against max_tokens and return no reasoning text.
      if (!response.content && response.finishReason === 'length' && (request.max_tokens ?? 0) < THINKING_BUDGET) {
        return { ...(await requestOnce(endpoint, { ...request, max_tokens: THINKING_BUDGET }, options)), budgetRaised: true };
      }
      return response;
    } catch (error) {
      const transient = error.retryable || error.name === 'TypeError' || error.name === 'TimeoutError';
      if (!transient || Date.now() > deadline) throw error;
      await new Promise(done => setTimeout(done, 30_000));
    }
  }
}

const THINKING_BUDGET = 6000;
async function requestOnce(endpoint, request, { apiKey = process.env.ENDERS_BENCH_API_KEY } = {}) {
  const response = await fetch(endpoint, {
    // Long enough for a thinking model's reasoning at local-server speeds.
    method: 'POST', signal: AbortSignal.timeout(600_000),
    headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: 'Bearer ' + apiKey }) },
    body: JSON.stringify(request),
  });
  // Include the provider's explanation (a retired model, a wrong name, a bad key) so a failure says what to fix.
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
    throw Object.assign(new Error('Model endpoint returned HTTP ' + response.status + (detail ? ': ' + detail : '')), { retryable: response.status >= 500 });
  }
  // A connection that drops mid-response leaves a truncated body: retry it like a network error.
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { throw Object.assign(new Error('Truncated response from model endpoint (' + raw.length + ' bytes)'), { retryable: true }); }
  const message = body.choices?.[0]?.message ?? {};
  // Thinking models served with a reasoning parser (vLLM --reasoning-parser) return their reasoning separately.
  const reasoning = message.reasoning_content ?? message.reasoning ?? null;
  return {
    content: message.content ?? null,
    ...(reasoning && { reasoning }),
    finishReason: body.choices?.[0]?.finish_reason ?? null,
    model: body.model ?? null,
    systemFingerprint: body.system_fingerprint ?? null,
    usage: body.usage ?? null,
  };
}

// Tolerant of what hosted APIs add around the schema: a code fence or a sentence around the JSON object, and extra
// keys (dropped). Every required field must still be present and valid. Two Qwen3 desk runs failed on an extra key.
export function parseModelOutput(content, format) {
  const text = String(content ?? '').trim();
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  const parsed = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  const schema = format.json_schema.schema;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || schema.required.some(key => !(key in parsed))) throw new Error('Unexpected response shape');
  const value = Object.fromEntries(schema.required.map(key => [key, parsed[key]]));
  for (const key of schema.required) {
    const field = schema.properties[key];
    const item = value[key];
    if (field.type === 'array') {
      if (!Array.isArray(item) || (field.maxItems !== undefined && item.length > field.maxItems) ||
          item.some(element => (field.items.enum ? !field.items.enum.includes(element) : typeof element !== field.items.type))) throw new Error('Invalid field: ' + key);
    } else if (field.type === 'integer') {
      if (!Number.isInteger(item) || (field.minimum !== undefined && item < field.minimum) ||
          (field.maximum !== undefined && item > field.maximum)) throw new Error('Invalid field: ' + key);
    } else if (typeof item !== field.type || (field.enum && !field.enum.includes(item))) {
      throw new Error('Invalid field: ' + key);
    }
  }
  return value;
}
