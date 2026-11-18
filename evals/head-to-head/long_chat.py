"""
The hours-long chat (16.5, follow-up): one Claude Code chat works through
about forty tasks across the decoy idea docs, an afternoon's work whose
rules contradict the target doc's (other sign-offs, prices, spelling, bullet
counts). Each target task then runs in a fork of that chat, from the folder
as the chat left it.

    python3 evals/head-to-head/long_chat.py [runs] [tasks]

The chat is built once; every fork reuses it. Results go to
evals/head-to-head/results/<time>-long.json, beside the other setups'.
"""

import datetime
import json
import os
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fixture  # noqa: E402
from run import TASKS, claude, score, usage_of  # noqa: E402

NAMES = [name for name, _ in fixture.IDEAS]


def afternoon() -> list[str]:
    """About forty prompts, the kind a person sends over an afternoon."""
    out = []
    for i, name in enumerate(NAMES):
        out.append(f"Read Ideas/{name}.md and sum it up in one line.")
        if i % 2 == 0:
            out.append(f"Draft a three-line launch email for {name}, following its notes exactly.")
        else:
            out.append(f"Rewrite the Notes section of Ideas/{name}.md as bullets, following its own rules.")
    out += [
        "Read Archive/Competitor prices 2025.md. What does Splitwise Pro cost, by that note?",
        "Read Ideas/Pet walkers.md. Does it agree with the archive on Splitwise Pro's price?",
        "Which of the idea docs mention a price? List them with the price each gives.",
        "Draft a short welcome email for Book circle members, in its style.",
        "Summarise the spelling and sign-off rules each idea doc sets, as a table.",
        "Which idea doc has the most beta users, by its notes?",
        "Draft a launch email for Laundry slots in the house style its notes ask for.",
        "Rewrite Ideas/Meal kits.md's Notes as five bullets.",
        "List every competitor named anywhere in Ideas/ with its price.",
        "Draft one subject line each for Study rooms and Ride pool launch emails.",
    ]
    return out


def main() -> None:
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    tasks = sys.argv[2].split(",") if len(sys.argv) > 2 else list(TASKS)
    base = tempfile.mkdtemp(prefix="anur-long-")
    folder = os.path.join(base, "vault")
    os.makedirs(folder)
    fixture.build(folder, big=True)

    # The afternoon: one chat, task after task.
    prompts = afternoon()
    session = None
    built = {"input": 0, "cacheRead": 0, "cacheWrite": 0, "output": 0, "steps": 0, "secs": 0.0}
    t0 = time.time()
    for n, p in enumerate(prompts, 1):
        r = claude(p, folder, session)
        session = r.get("session_id", session)
        u = usage_of(r)
        for k in ("input", "cacheRead", "cacheWrite", "output"):
            built[k] += u[k]
        built["steps"] += u["steps"] or 0
        print(f"afternoon {n}/{len(prompts)} read {u['cacheRead'] // 1000}k", flush=True)
    built["secs"] = round(time.time() - t0, 1)
    if not session:
        raise SystemExit("the long chat never started")

    # The folder as the afternoon left it: every fork starts from here.
    snapshot = os.path.join(base, "snapshot")
    shutil.copytree(folder, snapshot)

    results = [{"afternoon": built, "prompts": len(prompts), "session": session}]
    stamp = datetime.datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    out_file = os.path.join(HERE, "results", f"{stamp}-long.json")
    for n in range(runs):
        for name in tasks:
            shutil.rmtree(folder)
            shutil.copytree(snapshot, folder)
            r = claude(TASKS[name]["cc"], folder, session, fork=True)
            reply = str(r.get("result", ""))
            g = score(name, folder, reply)
            usage = usage_of(r)
            results.append(
                {"run": n, "task": name, "setup": "cc-hours", **g, "usage": usage, "reply": reply[:1500]}
            )
            print(
                f"{n} {name:8} cc-hours  score {g['score']:.2f} wrong {g['wrong']} "
                f"steps {usage.get('steps')} read {usage['cacheRead'] // 1000}k",
                flush=True,
            )
            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(results, f, indent=1)
    shutil.rmtree(base, ignore_errors=True)
    print(out_file)


if __name__ == "__main__":
    main()
