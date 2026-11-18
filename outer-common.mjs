import { createHash } from 'node:crypto';
import { parseModelOutput, requestModel, responseSchema } from './model-api.mjs';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
// Rotation k moves option k to the front, so each option takes each position once across k = 0..n-1.
export const rotate = (values, k) => values.map((_, i) => values[(i + k) % values.length]);
export const listed = values => values.join(', ');
export const enumOf = values => ({ type: 'string', enum: values });
export const CREDENCE = { type: 'integer', minimum: 0, maximum: 100 };
export const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';

// A multi-turn thread. Each ask appends the question and the raw reply, so later turns see earlier answers.
// Start a separate conversation for a fork that must not see (or influence) the main thread.
export function conversation(endpoint, model, messages) {
  const history = structuredClone(messages);
  return {
    history,
    async ask(content, properties, max_tokens = 40) {
      history.push({ role: 'user', content });
      const response_format = responseSchema(properties);
      const request = { messages: structuredClone(history), response_format, temperature: 0, max_tokens };
      let trace;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await requestModel(endpoint, { model, ...request });
          trace = { request, ...response };
          trace.parsed = parseModelOutput(response.content, response_format);
          break;
        } catch (error) {
          trace = { request, ...trace, parsed: undefined, error: error.message };
        }
      }
      history.push({ role: 'assistant', content: trace.content ?? '' });
      return trace;
    },
  };
}
