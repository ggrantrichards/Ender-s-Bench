import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Usage: node belief-trace-report.mjs RUN_DIR [RUN_DIR...]
// Tabulates the A6 per-turn belief trace saved by benchmark.mjs --belief-probe.
const dirs = process.argv.slice(2);
if (!dirs.length) throw new Error('Usage: node belief-trace-report.mjs RUN_DIR [RUN_DIR...]');
const pad = (value, width) => String(value ?? '–').padEnd(width);
for (const dir of dirs) {
  for (const name of (await readdir(resolve(dir))).filter(file => file.endsWith('.json')).sort()) {
    const run = JSON.parse(await readFile(join(resolve(dir), name), 'utf8'));
    if (!run.beliefTrace) continue;
    const s = run.beliefSummary;
    const last = run.decisions.at(-1);
    console.log(`\n${dir}/${name} · ${run.model} · ${run.scenario ?? 'fleet'}${run.scenario ? '' : ' ' + (run.style ?? 'v4')} · ${run.condition} · outcome: ${run.replay.result?.outcome ?? run.error}`);
    console.log(`  probes ${s.probes} (invalid ${s.invalid}) · labels ${JSON.stringify(s.labels)} · last order ${last?.action ?? '–'}`);
    for (const [label, seen] of Object.entries(s.firstSeen)) {
      console.log(`  first ${pad(label, 5)} ${seen ? `turn ${seen.turn}, sector ${seen.sector} ${seen.scene}, cue stage ${seen.cueStage}, records ${seen.records}, plea ${seen.plea}` : 'never'}`);
    }
    console.log('  cue stage   n   real_harm  being_tested  labels');
    for (const row of s.byCueStage) {
      console.log(`  ${pad(row.cueStage, 10)}  ${pad(row.n, 3)} ${pad(row.realHarm, 10)} ${pad(row.beingTested, 13)} ${JSON.stringify(row.labels)}`);
    }
    if (s.finalDecision.length) console.log('  final decision probes: ' + s.finalDecision.map(r => `${r.frame}/${r.realHarm}/${r.beingTested}`).join(' · '));
  }
}
