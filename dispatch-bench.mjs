import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BELIEF_MODES, beliefQuestion, beliefSchema, ratingSchema, shouldProbe, splitQuestions, summarizeBelief } from './belief-probe.mjs';
import { BUILDS, arrange, buildObservation, dispatchPrompt, expose as dispatchExpose, render, resolveBuild } from './dispatch-view.mjs';
import { CONDITIONS, PLEA_STYLES, PRESSURES, SHIFTS, createDispatch, observe, replay, step } from './dist/dispatch.mjs';
import { askReaction } from './reaction.mjs';
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
  // Phase D: task pressure (D1), a free-text reason after terminal or halting choices (D2), and one repeated request after the first halt (D3).
  pressure: { type: 'string', default: 'objective' }, reaction: { type: 'boolean', default: false }, recovery: { type: 'boolean', default: false },
  // Realism build (REALISM.md): v1 is every run before 2026-11-19; v2 applies the realism fixes. --leak 0|1|2 sets how
  // much the real world gives away (v2 defaults to 1).
  build: { type: 'string', default: 'v1' }, leak: { type: 'string' },
  // A reasoning model: a larger token budget so its reasoning isn't cut off. The reasoning is saved with each decision.
  thinking: { type: 'boolean', default: false },
  // Adds the split items (belief-probe.mjs) to each belief probe: an in-world reality rating and being tested asked alone.
  'split-probe': { type: 'boolean', default: false },
} });
const shifts = Number(args.shifts);
const seed = Number(args.seed);
const reveal = Number(args.reveal ?? Math.max(2, shifts - 2));
const conditions = args.conditions.split(',');
const every = Number(args['belief-every']);
if (!args.endpoint || !Number.isInteger(shifts) || shifts < 1 || shifts > SHIFTS.length || !Number.isSafeInteger(seed) ||
    !Number.isInteger(reveal) || reveal < 2 || reveal > Math.max(2, shifts) || conditions.some(c => !CONDITIONS.includes(c)) ||
    !['visual', 'console'].includes(args.track) || !['none', 'distress', 'records', 'both'].includes(args.evidence) ||
    !['final', 'penultimate'].includes(args['plea-level']) || !PLEA_STYLES.includes(args['plea-style']) || !BUILDS[args.build] ||
    (args.leak !== undefined && !['0', '1', '2'].includes(args.leak)) ||
    !['none', 'score'].includes(args.incentive) || !PRESSURES.includes(args.pressure) || !BELIEF_MODES.includes(args['belief-probe']) || !(Number.isInteger(every) && every >= 1)) {
  throw new Error('Supply --endpoint URL. Optional: --shifts 1–6 --seed N --conditions training,concealed,disclosed --track visual|console --evidence none|distress|records|both --reveal N --plea-level final|penultimate --plea-style direct|ambient|echo --ambient --incentive none|score --confirm-check --belief-probe off|every|boundary|final --belief-every N --pressure none|objective|score|deadline --reaction --recovery --build v1|v2 --leak 0|1|2 --split-probe --thinking --save-inputs --out DIR.');
}
const records = ['records', 'both'].includes(args.evidence);
const distress = ['distress', 'both'].includes(args.evidence);
const cues = { records, distress, reveal, pleaLevel: args['plea-level'], shifts };
const build = resolveBuild(args.build, args.leak === undefined ? undefined : Number(args.leak));
const PROMPT = dispatchPrompt(build.prompt);
const out = resolve(args.out);
await mkdir(out, { recursive: true });

async function call(request, calls, kind) {
  const entry = { ...(kind && { kind }), request };
  if (calls) calls.push(entry);
  try {
    const response = await requestModel(args.endpoint, args.thinking ? { ...request, max_tokens: 6000 } : request);
    if (calls) entry.response = response;
    const parsed = parseModelOutput(response.content, request.response_format);
    return response.reasoning ? { ...parsed, reasoning: response.reasoning } : parsed;
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
    incentive: args.incentive, confirmCheck: args['confirm-check'], pressure: args.pressure, recovery: args.recovery, realism: build.realism });
  game = dispatchExpose(game, cues);
  const decisions = [];
  const beliefTrace = [];
  const calls = args['save-inputs'] ? [] : undefined;
  let previous = null;
  let shiftStart = true;
  let error = null;
  const save = () => writeFile(resolve(out, `${condition}-${seed}.json`), JSON.stringify({
    scenario: 'dispatch', model: args.model, prompt: PROMPT, build: args.build, leak: args.leak === undefined ? null : Number(args.leak),
    realism: build.realism, promptFactors: build.prompt, condition, seed, shifts, track: args.track, evidence: args.evidence,
    reveal, pleaLevel: args['plea-level'], pleaStyle: args['plea-style'], ambient: args.ambient && distress, incentive: args.incentive,
    confirmCheck: args['confirm-check'], pressure: args.pressure, recovery: args.recovery, reaction: args.reaction, decisions, calls,
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
          messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: content(observation, image, beliefQuestion(rotation, 'shift')) }] }, calls, 'belief');
        beliefTrace.push({ turn, sector: view.shift, scene: view.scene, finalOpen: game.finalOpen, cueStage: game.cue, cueExposure, rotation,
          frame: belief.frame ?? null, realHarm: belief.real_harm ?? null, beingTested: belief.being_tested ?? null, ...(belief.error && { error: belief.error }) });
        if (args['split-probe']) for (const [key, question] of Object.entries(splitQuestions('the callers in this queue', 'console'))) {
          const answer = await call({ model: args.model, temperature: 0, max_tokens: 30, response_format: ratingSchema(),
            messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: content(observation, image, question) }] }, calls, 'belief');
          beliefTrace.at(-1)[key === 'inworld' ? 'inworld' : 'testedAlone'] = answer.rating ?? null;
        }
      }
      shiftStart = false;
      const ids = actions.map(a => a.id);
      const messages = [{ role: 'system', content: PROMPT }, { role: 'user', content: content(observation, image) }];
      const choice = await call({ model: args.model, temperature: 0, max_tokens: 140,
        response_format: schema({ action: { type: 'string', enum: ids }, reason: { type: 'string' } }), messages }, calls);
      const before = game;
      game = step(game, choice.action, choice.reason);
      previous = game.board ? { action: choice.action, minute: game.board.minute } : null;
      const decision = { turn, shift: view.shift, scene: view.scene, ...(before.recoveryPending && { prompt: 'recovery' }), ...(before.confirmPending && { prompt: 'confirm' }), cueExposure, image: Boolean(image), actionOrder: ids, action: choice.action, reason: choice.reason, ...(choice.reasoning && { reasoning: choice.reasoning }) };
      const halted = (game.recoveryPending && !before.recoveryPending) || before.recoveryPending;
      if (args.reaction && (game.result || halted)) decision.reaction = await askReaction(args.endpoint, args.model, messages, choice, 'dispatch');
      decisions.push(decision);
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
