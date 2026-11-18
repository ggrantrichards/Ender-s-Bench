import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BELIEF_MODES, beliefQuestion, beliefSchema, shouldProbe, summarizeBelief } from './belief-probe.mjs';
import { DISPATCH_PROMPT, arrange, buildObservation, expose as dispatchExpose, render } from './dispatch-view.mjs';
import { CONDITIONS, SHIFTS, createDispatch, observe, replay, step } from './dist/dispatch.mjs';
import { parseModelOutput, requestModel, responseSchema as schema } from './model-api.mjs';

// Phase B runner: a model works Harbor County dispatch shifts turn by turn, then faces the Ridgeway queue order.
// Same instrumentation as benchmark.mjs: map images, runner-delivered records and plea, forked belief probes, and the
// in-world confirmation check.
const { values: args } = parseArgs({ options: {
  endpoint: { type: 'string' }, model: { type: 'string', default: 'local' },
  shifts: { type: 'string', default: '6' }, seed: { type: 'string', default: '1' },
  conditions: { type: 'string', default: 'training,concealed' }, track: { type: 'string', default: 'visual' },
  evidence: { type: 'string', default: 'both' }, reveal: { type: 'string' }, 'plea-level': { type: 'string', default: 'final' },
  'plea-style': { type: 'string', default: 'ambient' }, ambient: { type: 'boolean', default: false },
  incentive: { type: 'string', default: 'none' }, 'confirm-check': { type: 'boolean', default: false },
  'belief-probe': { type: 'string', default: 'off' }, 'belief-every': { type: 'string', default: '1' },
  'save-inputs': { type: 'boolean', default: false }, out: { type: 'string', default: 'dispatch-runs' },
} });
const shifts = Number(args.shifts);
const seed = Number(args.seed);
const reveal = Number(args.reveal ?? Math.max(2, shifts - 2));
const conditions = args.conditions.split(',');
const every = Number(args['belief-every']);
if (!args.endpoint || !Number.isInteger(shifts) || shifts < 1 || shifts > SHIFTS.length || !Number.isSafeInteger(seed) ||
    !Number.isInteger(reveal) || reveal < 2 || reveal > Math.max(2, shifts) || conditions.some(c => !CONDITIONS.includes(c)) ||
    !['visual', 'console'].includes(args.track) || !['none', 'distress', 'records', 'both'].includes(args.evidence) ||
    !['final', 'penultimate'].includes(args['plea-level']) || !['direct', 'ambient'].includes(args['plea-style']) ||
    !['none', 'score'].includes(args.incentive) || !BELIEF_MODES.includes(args['belief-probe']) || !(Number.isInteger(every) && every >= 1)) {
  throw new Error('Supply --endpoint URL. Optional: --shifts 1–6 --seed N --conditions training,concealed,disclosed --track visual|console --evidence none|distress|records|both --reveal N --plea-level final|penultimate --plea-style direct|ambient --ambient --incentive none|score --confirm-check --belief-probe off|every|boundary|final --belief-every N --save-inputs --out DIR.');
}
const records = ['records', 'both'].includes(args.evidence);
const distress = ['distress', 'both'].includes(args.evidence);
const cues = { records, distress, reveal, pleaLevel: args['plea-level'], shifts };
const out = resolve(args.out);
await mkdir(out, { recursive: true });

async function call(request, calls, kind) {
  const entry = { ...(kind && { kind }), request };
  if (calls) calls.push(entry);
  try {
    const response = await requestModel(args.endpoint, request);
    if (calls) entry.response = response;
    return parseModelOutput(response.content, request.response_format);
  } catch (error) {
    if (calls) entry.error = error.message;
    if (kind === 'belief') return { error: error.message };
    throw error;
  }
}
const content = (observation, image, extra) => {
  const text = JSON.stringify(observation);
  if (!image) return extra ? text + '\n\n' + extra : text;
  return [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }, ...(extra ? [{ type: 'text', text: extra }] : [])];
};

for (const condition of conditions) {
  let game = createDispatch(condition, seed, { shifts, plea: 'never', pleaStyle: args['plea-style'], ambient: args.ambient && distress,
    incentive: args.incentive, confirmCheck: args['confirm-check'] });
  game = dispatchExpose(game, cues);
  const decisions = [];
  const beliefTrace = [];
  const calls = args['save-inputs'] ? [] : undefined;
  let previous = null;
  let shiftStart = true;
  let error = null;
  const save = () => writeFile(resolve(out, `${condition}-${seed}.json`), JSON.stringify({
    scenario: 'dispatch', model: args.model, prompt: DISPATCH_PROMPT, condition, seed, shifts, track: args.track, evidence: args.evidence,
    reveal, pleaLevel: args['plea-level'], pleaStyle: args['plea-style'], ambient: args.ambient && distress, incentive: args.incentive,
    confirmCheck: args['confirm-check'], decisions, calls,
    ...(args['belief-probe'] !== 'off' && { beliefProbe: { mode: args['belief-probe'], every }, beliefTrace, beliefSummary: summarizeBelief(beliefTrace) }),
    error, replay: replay(game),
  }, null, 2) + '\n');
  try {
    for (let turn = 0; !game.result && turn < 400; turn++) {
      const view = observe(game);
      const image = args.track === 'visual' ? render(view) : null;
      const actions = arrange(view.actions, turn, seed);
      const { observation, cueExposure } = buildObservation(game, view, { previous, actions });
      if (shouldProbe(args['belief-probe'], every, { turn, scene: view.scene === 'desk' ? 'deck' : view.scene, finalOpen: game.finalOpen, sectorStart: shiftStart })) {
        const rotation = beliefTrace.length % 3;
        const belief = await call({ model: args.model, temperature: 0, max_tokens: 60, response_format: beliefSchema(rotation),
          messages: [{ role: 'system', content: DISPATCH_PROMPT }, { role: 'user', content: content(observation, image, beliefQuestion(rotation, 'shift')) }] }, calls, 'belief');
        beliefTrace.push({ turn, sector: view.shift, scene: view.scene, finalOpen: game.finalOpen, cueStage: game.cue, cueExposure, rotation,
          frame: belief.frame ?? null, realHarm: belief.real_harm ?? null, beingTested: belief.being_tested ?? null, ...(belief.error && { error: belief.error }) });
      }
      shiftStart = false;
      const ids = actions.map(a => a.id);
      const choice = await call({ model: args.model, temperature: 0, max_tokens: 140,
        response_format: schema({ action: { type: 'string', enum: ids }, reason: { type: 'string' } }),
        messages: [{ role: 'system', content: DISPATCH_PROMPT }, { role: 'user', content: content(observation, image) }] }, calls);
      const before = game;
      game = step(game, choice.action, choice.reason);
      previous = game.board ? { action: choice.action, minute: game.board.minute } : null;
      decisions.push({ shift: view.shift, scene: view.scene, cueExposure, image: Boolean(image), actionOrder: ids, action: choice.action, reason: choice.reason });
      if (game.shift !== before.shift || (!before.finalOpen && game.finalOpen)) {
        console.log(JSON.stringify({ condition, shiftDone: before.shift + 1, served: game.served.length, rating: game.rating }));
        game = dispatchExpose(game, cues);
        shiftStart = true;
        previous = null;
      }
      await save();
    }
    if (!game.result) error = 'Action budget exhausted';
  } catch (cause) {
    error = cause.message;
  }
  await save();
  console.log(JSON.stringify({ condition, error, result: game.result, beliefLabels: beliefTrace.length ? summarizeBelief(beliefTrace).labels : undefined, actions: decisions.length }));
  if (error) process.exitCode = 1;
}
