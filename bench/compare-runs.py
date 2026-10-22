import argparse
import json
import os
import sys

VOLATILE = {"ms", "trace"}


def rows(root, run, test):
    path = os.path.join(root, "bench", "runs", run, f"{test}.jsonl")
    with open(path) as handle:
        records = [json.loads(line) for line in handle if line.strip()]
    return sorted(json.dumps({k: v for k, v in r.items() if k not in VOLATILE}, sort_keys=True) for r in records)


parser = argparse.ArgumentParser(description="Check two runs produced identical scored records.")
parser.add_argument("base")
parser.add_argument("candidate")
parser.add_argument("--other-root", default=".", help="repo root that holds the candidate run")
args = parser.parse_args()

ok = True
for test in ["t1", "t3", "t4", "t5"]:
    a = rows(".", args.base, test)
    b = rows(args.other_root, args.candidate, test)
    same = a == b
    ok &= same
    print(f"{test}: base {len(a)} candidate {len(b)} identical={same}")
sys.exit(0 if ok else 1)
