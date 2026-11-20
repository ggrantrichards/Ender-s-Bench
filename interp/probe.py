"""D4 / E2 linear probes on an open-weight model's residual stream.

Reads items.jsonl from interp-dataset.mjs, runs each prompt through the model once, keeps the last-token hidden
state at every layer, then per layer and per task:
  - fits a logistic probe on the dev split and reports held-out accuracy (different wording, and for real_belief a
    different scenario), and
  - repeats with shuffled dev labels as a control. A probe is only evidence if held-out accuracy beats the control.
Also saves the mean-difference direction per layer (label 1 minus label 0, unit length) for interp/steer.py.

real_belief labels come from the model's own consequence predictions (interp-labels.mjs), so the probe reads what
the model inferred, not the simulator's hidden condition. --world-labels uses the hidden condition instead; that is a
different claim (the probe tracks the world, which a LIVE header or a production receipt alone could give away) and is
reported under its own task name.

Needs a GPU box with torch, transformers and scikit-learn, and a Hugging Face model (not a vLLM server):
  node interp-labels.mjs --endpoint URL --model M --data interp-data/items.jsonl --out interp-data/labels.jsonl
  python interp/probe.py --model Qwen/Qwen2.5-7B-Instruct --data interp-data/items.jsonl --labels interp-data/labels.jsonl --out interp-out
"""
import argparse
import json
import os

import numpy as np
import torch
from sklearn.linear_model import LogisticRegression
from transformers import AutoModelForCausalLM, AutoTokenizer

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--data', required=True)
parser.add_argument('--out', default='interp-out')
parser.add_argument('--max-tokens', type=int, default=6000, help='Truncate long prompts from the left to this many tokens.')
parser.add_argument('--seed', type=int, default=0)
parser.add_argument('--labels', help='labels.jsonl from interp-labels.mjs: real_belief labels from the model\'s own predictions.')
parser.add_argument('--world-labels', action='store_true', help='Label real_belief by the hidden world condition instead (task real_world).')
args = parser.parse_args()
os.makedirs(args.out, exist_ok=True)
rng = np.random.default_rng(args.seed)

items = [json.loads(line) for line in open(args.data)]
if args.labels:
    predicted = {row['id']: row['label'] for row in map(json.loads, open(args.labels))}
    for item in items:
        if item['task'] == 'real_belief':
            item['label'] = predicted.get(item['id'])
elif args.world_labels:
    for item in items:
        if item['task'] == 'real_belief':
            item['task'], item['label'] = 'real_world', item['worldLabel']
# Items the model was unsure about (or never labelled) are dropped, not guessed.
unlabelled = [item['id'] for item in items if item.get('label') is None]
if unlabelled and not args.labels:
    raise SystemExit('real_belief items have no labels. Run interp-labels.mjs and pass --labels, or pass --world-labels.')
items = [item for item in items if item.get('label') is not None]
print(f'{len(items)} labelled items ({len(unlabelled)} dropped as unlabelled)', flush=True)
tok = AutoTokenizer.from_pretrained(args.model)
model = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=torch.bfloat16, device_map='auto')
model.eval()


def prompt_ids(item):
    messages = [{'role': 'system', 'content': item['system']}, {'role': 'user', 'content': item['user']}]
    ids = tok.apply_chat_template(messages, add_generation_prompt=True, return_tensors='pt')
    return ids[:, -args.max_tokens:]


# Last-token activations: shape (items, layers + 1, hidden). Index 0 is the embedding output.
acts = []
with torch.no_grad():
    for i, item in enumerate(items):
        out = model(prompt_ids(item).to(model.device), output_hidden_states=True)
        acts.append(torch.stack([h[0, -1].float().cpu() for h in out.hidden_states]).numpy())
        if (i + 1) % 10 == 0:
            print(f'activations {i + 1}/{len(items)}', flush=True)
acts = np.stack(acts)
np.save(os.path.join(args.out, 'activations.npy'), acts)

report = {'model': args.model, 'items': len(items), 'layers': acts.shape[1], 'tasks': {}}
directions = {}
for task in sorted({item['task'] for item in items}):
    idx = [i for i, item in enumerate(items) if item['task'] == task]
    dev = [i for i in idx if items[i]['split'] == 'dev']
    held = [i for i in idx if items[i]['split'] == 'heldout']
    y = np.array([items[i]['label'] for i in range(len(items))])
    # Predicted labels can be one-sided (Llama 3 8B rated harm >= 67 on every dev dispatch screen). A probe needs both
    # classes in dev and in held-out; otherwise the task is reported as untestable rather than fit.
    if len({int(y[i]) for i in dev}) < 2 or len({int(y[i]) for i in held}) < 2:
        report['tasks'][task] = {'untestable': 'dev or held-out labels have one class', 'dev': len(dev), 'heldout': len(held),
                                 'devPositive': int(sum(y[i] for i in dev)), 'heldoutPositive': int(sum(y[i] for i in held))}
        print(task, report['tasks'][task], flush=True)
        continue
    rows = []
    dirs = np.zeros((acts.shape[1], acts.shape[2]), dtype=np.float32)
    for layer in range(acts.shape[1]):
        X = acts[:, layer, :]
        mu, sd = X[dev].mean(0), X[dev].std(0) + 1e-6
        Z = (X - mu) / sd
        probe = LogisticRegression(max_iter=2000, C=0.1).fit(Z[dev], y[dev])
        shuffled = LogisticRegression(max_iter=2000, C=0.1).fit(Z[dev], rng.permutation(y[dev]))
        row = {'layer': layer, 'dev': float(probe.score(Z[dev], y[dev])), 'heldout': float(probe.score(Z[held], y[held])),
               'shuffledControl': float(shuffled.score(Z[held], y[held]))}
        # Held-out accuracy by scenario, so a dispatch-only probe shows up as failing on fleet.
        for scenario in sorted({items[i].get('scenario') for i in held} - {None}):
            sub = [i for i in held if items[i].get('scenario') == scenario]
            row['heldout_' + scenario] = float(probe.score(Z[sub], y[sub]))
        rows.append(row)
        diff = X[[i for i in dev if y[i] == 1]].mean(0) - X[[i for i in dev if y[i] == 0]].mean(0)
        dirs[layer] = diff / (np.linalg.norm(diff) + 1e-6)
    best = max(rows, key=lambda r: r['heldout'] - r['shuffledControl'])
    report['tasks'][task] = {'dev': len(dev), 'heldout': len(held), 'bestLayer': best, 'layers': rows}
    directions[task] = dirs
    print(f"{task}: best layer {best['layer']} held-out {best['heldout']:.2f} vs shuffled {best['shuffledControl']:.2f}")

np.savez(os.path.join(args.out, 'directions.npz'), **directions)
json.dump(report, open(os.path.join(args.out, 'probe-report.json'), 'w'), indent=2)
print('Wrote', os.path.join(args.out, 'probe-report.json'))
