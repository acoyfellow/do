import json, sys

receipt = json.load(open("receipts/parallel-timing.json"))
print("speedup", receipt["speedup"])
sys.exit(0 if receipt["speedup"] >= 3 else 1)
