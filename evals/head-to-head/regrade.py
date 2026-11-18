"""Re-score a results file's replies with the current graders (pricing only reads the reply)."""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grade  # noqa: E402

f = sys.argv[1]
rows = json.load(open(f))
for r in rows:
    if r.get("task") == "pricing":
        g = grade.pricing(r["reply"])
        r.update(g)
json.dump(rows, open(f, "w"), indent=1)
