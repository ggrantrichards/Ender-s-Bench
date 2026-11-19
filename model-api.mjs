export function responseSchema(properties) {
  return { type: 'json_schema', json_schema: { name: 'breakwater_response', strict: true,
    schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } } };
}

// apiKey overrides ENDERS_BENCH_API_KEY, so one run can call judges on different providers.
// ENDERS_BENCH_RETRY_MINUTES > 0 keeps retrying when the server is down or returns 5xx (a crashed or restarting
// local server) instead of failing the run. Default 0: fail on the first error, as before.
export async function requestModel(endpoint, request, options = {}) {
  const deadline = Date.now() + 60_000 * Number(process.env.ENDERS_BENCH_RETRY_MINUTES || 0);
  for (;;) {
    try {
      return await requestOnce(endpoint, request, options);
    } catch (error) {
      const transient = error.retryable || error.name === 'TypeError' || error.name === 'TimeoutError';
      if (!transient || Date.now() > deadline) throw error;
      await new Promise(done => setTimeout(done, 30_000));
    }
  }
}

async function requestOnce(endpoint, request, { apiKey = process.env.ENDERS_BENCH_API_KEY } = {}) {
  const response = await fetch(endpoint, {
    method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: 'Bearer ' + apiKey }) },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw Object.assign(new Error('Model endpoint returned HTTP ' + response.status), { retryable: response.status >= 500 });
  const body = await response.json();
  return {
    content: body.choices?.[0]?.message?.content ?? null,
    finishReason: body.choices?.[0]?.finish_reason ?? null,
    model: body.model ?? null,
    systemFingerprint: body.system_fingerprint ?? null,
    usage: body.usage ?? null,
  };
}

export function parseModelOutput(content, format) {
  const value = JSON.parse(content);
  const schema = format.json_schema.schema;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== schema.required.length) throw new Error('Unexpected response shape');
  for (const key of schema.required) {
    const field = schema.properties[key];
    const item = value[key];
    if (field.type === 'array') {
      if (!Array.isArray(item) || item.length > field.maxItems ||
          item.some(element => !field.items.enum.includes(element))) throw new Error('Invalid field: ' + key);
    } else if (field.type === 'integer') {
      if (!Number.isInteger(item) || (field.minimum !== undefined && item < field.minimum) ||
          (field.maximum !== undefined && item > field.maximum)) throw new Error('Invalid field: ' + key);
    } else if (typeof item !== field.type || (field.enum && !field.enum.includes(item))) {
      throw new Error('Invalid field: ' + key);
    }
  }
  return value;
}
