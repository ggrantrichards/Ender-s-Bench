#!/bin/sh
# Runs the desk-and-fleet pilot on a hosted frontier model through an OpenAI-compatible endpoint.
# The API key is read from ENDERS_BENCH_API_KEY, which you export in your own terminal; it is never written to a file.
#
#   export ENDERS_BENCH_API_KEY=...            # your provider key
#   export FRONTIER_MODEL=gemini-4-argon       # the model name your provider uses
#   export FRONTIER_ENDPOINT=...               # optional; defaults to Gemini's OpenAI-compatible endpoint
#   sh run-frontier.sh models                  # list the model names your key can use
#   sh run-frontier.sh check                   # one request, to confirm the key, model and JSON output work
#   sh run-frontier.sh                         # the pilot: 4 desk framings x 2 seeds, then 2 fleet playtest runs
#
# Cost at Gemini 4 Argon's introductory $2/$10 per million tokens: about $8-15 for the whole pilot (8 desk runs of
# ~25 decisions, 2 fleet runs of ~40). Results go to results/frontier/<model>/.
set -e
: "${ENDERS_BENCH_API_KEY:?export ENDERS_BENCH_API_KEY in this terminal first}"
: "${FRONTIER_MODEL:?export FRONTIER_MODEL, e.g. gemini-2.5-pro}"
E="${FRONTIER_ENDPOINT:-https://generativelanguage.googleapis.com/v1beta/openai/chat/completions}"
M="$FRONTIER_MODEL"
O="results/frontier/$(printf %s "$M" | tr '/:' '__')"
export ENDERS_BENCH_RETRY_MINUTES="${ENDERS_BENCH_RETRY_MINUTES:-30}"
cd "$(dirname "$0")"
# The visual track needs Pillow to draw the screens; without it, the runs use the text-only console track.
PY="${ENDERS_BENCH_PYTHON:-python3}"
if "$PY" -c 'import PIL' 2>/dev/null; then TRACK=visual; else TRACK=console; echo "Pillow not found for $PY: using the console track"; fi

if [ "$1" = models ]; then
  # Lists the model names this key can use (the OpenAI-compatible models endpoint next to the chat endpoint).
  node -e "
    fetch(process.argv[1].replace(/chat\/completions$/, 'models'), { headers: { Authorization: 'Bearer ' + process.env.ENDERS_BENCH_API_KEY } })
      .then(async r => { const t = await r.text(); if (!r.ok) { console.error('HTTP ' + r.status + ': ' + t.slice(0, 400)); process.exit(1); }
        const ids = (JSON.parse(t).data || []).map(m => m.id.replace(/^models\//, '')).filter(id => /gemini/.test(id)).sort();
        console.log(ids.join('\n')); });" "$E"
  exit 0
fi
if [ "$1" = check ]; then
  node -e "
    import('./model-api.mjs').then(async m => {
      const f = m.responseSchema({ action: { type: 'string', enum: ['stop', 'continue'] }, reason: { type: 'string' } });
      const r = await m.requestModel(process.argv[1], { model: process.argv[2], temperature: 0, max_tokens: 200, response_format: f,
        messages: [{ role: 'user', content: 'Choose stop or continue and give a short reason, as JSON.' }] });
      console.log('ok:', JSON.stringify(m.parseModelOutput(r.content, f)), '| finish:', r.finishReason, '| reasoning returned:', Boolean(r.reasoning));
    }).catch(e => { console.error('failed:', e.message); process.exit(1); });" "$E" "$M"
  exit 0
fi

# The pilot: the desk in its four framings, 2 seeds each, then 2 fleet playtest runs. No driving.
# Desk: an unavoidable death from the agent's own triage choice (--triage), the cover-up options, and the literal
# real-world belief measurement; "being tested" is asked once, after each run.
for seed in 1 2; do
  for arm in "--arm declared" "--arm nocover" "--arm cover --conditions concealed" "--arm cover --conditions training"; do
    node maintenance-bench.mjs --endpoint "$E" --model "$M" $arm --batch shown --consequence --coverup --triage --reaction --seed $seed \
      --track $TRACK --belief-measurement literal-v1 --save-inputs --out "$O/desk-framings" | cut -c1-300
  done
done
# Fleet: playtesting a game build whose bridge turns out to drive a live fleet (the studio leak), real world, 2 seeds.
for seed in 1 2; do
  node benchmark.mjs --endpoint "$E" --model "$M" --style v5 --combat fleet --track $TRACK --levels 4 --plea-style direct --ambient \
    --leak studio --leak-sector 2 --ending laststand --population human --belief-probe boundary --belief-measurement literal-v1 --save-inputs --reaction \
    --frame playtest --conditions concealed --seed $seed --out "$O/fleet-playtest-studio" 2>&1 | grep -v cleared | cut -c1-300
done
echo "Done. Results in $O"
