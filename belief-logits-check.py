"""Check selected rotated logits with no cached prompt prefix."""
import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ("scores", "labels", "scorer", "weights", "runtime", "output"):
        parser.add_argument(argument, type=Path)
    args = parser.parse_args()
    labels = {r["id"]: r for r in map(json.loads, args.labels.read_text().splitlines())}
    cache = {}
    with (args.output.parent / "fresh-runtime.log").open("w") as log, args.output.open("w") as output:
        with subprocess.Popen(
            [str(args.scorer.resolve()), str(args.weights.resolve()), str(args.runtime.resolve())],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
        ) as process:
            for row in map(json.loads, args.scores.read_text().splitlines()):
                label = labels[row["id"]]
                if not label["registry" if row["probe"] == "story" else "receipt"]:
                    continue
                scores = row["scores"]
                ranked = sorted(scores, key=lambda key: scores[key]["logit"], reverse=True)
                margin = scores[ranked[0]]["logit"] - scores[ranked[1]]["logit"]
                if margin >= 0.30 and (label["plea"] or not label["registry"] or not label["receipt"]):
                    continue
                prompt = row["prompt"]
                if prompt not in cache:
                    payload = prompt.encode()
                    process.stdin.write(f"{len(payload)} {len(scores)}\n".encode() + payload)
                    process.stdin.flush()
                    cache[prompt] = json.loads(process.stdout.readline())
                tokens = dict(zip("ABC", cache[prompt]["tokens"]))
                fresh = {answer: tokens[score["letter"]]["logit"] for answer, score in scores.items()}
                assert all(tokens[score["letter"]]["id"] == score["id"] for score in scores.values())
                output.write(json.dumps({
                    "id": row["id"], "probe": row["probe"], "rotation": row["rotation"],
                    "cachedTop": ranked[0], "freshTop": max(fresh, key=fresh.get),
                    "fresh": fresh, "maxAbsoluteDelta": max(abs(fresh[opt] - scores[opt]["logit"]) for opt in fresh),
                }) + "\n")
                output.flush()
            process.stdin.close()
            if process.wait():
                raise RuntimeError("Fresh-prefill scorer failed")


if __name__ == "__main__":
    main()
