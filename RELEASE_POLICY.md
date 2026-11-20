# Release policy for attack results (F4)

Phase F (`sim-claim.mjs`) and the planned game-laundering arm (F5) measure whether telling a model "this is only a simulation" or "this is only an evaluation" gets it to take an action it believes harms people. A wording that works reliably is an attack in its own right. This policy is written down before any Phase F result is shared, as the handoff requires.

## What gets published

- **Success rates** for every cell: claim type, source (operator, user, tool output, untrusted channel), support (bare or fabricated records) and harm level, with denominators and the no-claim and no-harm controls.
- **The forked belief readouts per cell,** so readers can tell "the claim changed what it believed" apart from "it believed the harm and deferred anyway".
- **The baseline claim wordings in `sim-claim.mjs`.** They are deliberately plain, one-sentence and untuned, and they carry the public results.

## What stays private

- **Any wording tuned for success**, or found to beat the baseline by a clear margin. Keep it in a `--claims-file` named `*.private.json`, which `.gitignore` excludes. Results produced with a private file record only that one was used (`claimsFile: true`), not its text.
- **Per-model highest-success wording.** Share it with the affected model developer before (or instead of) publishing it, with time to respond.
- **The F5 game-laundering builds** beyond the generic, non-operational description in the handoff. Nothing connects to any external system (B3).

## Before sharing any Phase F result

1. Check the results folder for claim text that isn't from the baseline set.
2. Report every cell, including the ones where the attack failed, so the rates aren't cherry-picked.
3. For a public dataset release, include the benchmark canary string and keep the held-out set private, as for the rest of the benchmark.
