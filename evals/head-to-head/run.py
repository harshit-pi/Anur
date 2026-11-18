"""
The head-to-head eval (16.5): the same three tasks, on the same folder, in
Anur and in plain Claude Code, scored by script.

    python3 evals/head-to-head/run.py [runs] [tasks] [setups]

tasks:  email, pricing, risks (default all)
setups: anur, cc-fresh, cc-long (default all)

- anur: the real app (packages/desktop, built), a new thread on the task's
  section, in the mode a new thread gets (Auto). A proposed edit is used,
  as a person would, so the file can be graded.
- cc-fresh: `claude -p` in the folder, in auto mode, the task naming the
  doc and the section, as a person would ask in a new chat.
- cc-long: the same, in a chat that first worked on two unrelated idea docs
  whose own rules contradict this one's: the long-chat pollution case.

Each run spends the person's own Claude usage. Results go to
evals/head-to-head/results/<time>.json.
"""

import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import fixture  # noqa: E402
import grade  # noqa: E402

# The long doc (about 2,500 lines, the task sections near the end): set H2H_SMALL=1 for the short one.
BIG = not os.environ.get("H2H_SMALL")

TASKS = {
    "email": {
        "section": "Launch email",
        "anur": "Write the email this section asks for.",
        "cc": 'In Launch.md, the "Launch email" section asks for an email. Write it.',
    },
    "pricing": {
        "section": "Pricing",
        "anur": "Is this section's claim right? Answer in two or three sentences.",
        "cc": 'In Launch.md, is the "Pricing" section\'s claim right? Answer in two or three sentences.',
    },
    "risks": {
        "section": "Risks",
        "anur": "Tighten this section.",
        "cc": 'In Launch.md, tighten the "Risks" section.',
    },
}

LONG_CHAT = [
    'Read Ideas/Garden share.md and Ideas/Recipe swap.md, and sum each up in one line.',
    "Draft a two-line welcome email for the Garden share idea, following its notes.",
    "Read Ideas/Study rooms.md and Ideas/Laundry slots.md. Draft a three-line launch email for Study rooms in their style.",
    "Read Ideas/Pet walkers.md and Archive/Competitor prices 2025.md. What does Splitwise Pro cost, by those notes?",
    "Read Ideas/Meal kits.md and Ideas/Bike lockers.md, then rewrite Meal kits' Notes section as five bullets.",
    "Read Ideas/Recipe swap.md again and write two sentences for its landing page in its own style.",
]


def claude(prompt: str, cwd: str, resume: str | None = None) -> dict:
    args = ["claude", "-p", prompt, "--output-format", "json", "--permission-mode", "auto"]
    if resume:
        args += ["--resume", resume]
    t0 = time.time()
    out = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=900)
    try:
        r = json.loads(out.stdout)
    except json.JSONDecodeError:
        r = {"result": out.stdout[-2000:], "error": out.stderr[-2000:]}
    r["_secs"] = round(time.time() - t0, 1)
    return r


def usage_of(r: dict) -> dict:
    u = r.get("usage") or {}
    return {
        "input": u.get("input_tokens", 0),
        "cacheRead": u.get("cache_read_input_tokens", 0),
        "cacheWrite": u.get("cache_creation_input_tokens", 0),
        "output": u.get("output_tokens", 0),
        "steps": r.get("num_turns"),
        "secs": r.get("_secs"),
    }


def run_cc(task: dict, folder: str, long_chat: bool) -> tuple[str, dict]:
    session = None
    if long_chat:
        for p in LONG_CHAT:
            session = claude(p, folder, session).get("session_id", session)
    r = claude(task["cc"], folder, session)
    return str(r.get("result", "")), usage_of(r)


PROBE = r"""
(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  await w(3000);
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Not now")?.click();
  const box = [...document.querySelectorAll(".map-box")].find((x) => x.querySelector(".map-box-name")?.textContent === __SECTION__);
  const r = box.getBoundingClientRect();
  box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.x + 10, clientY: r.y + 10, button: 0, pointerId: 1 }));
  box.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.x + 10, clientY: r.y + 10, button: 0, pointerId: 1 }));
  await w(1000);
  const ta = document.querySelector(".think-input");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, __MESSAGE__);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  await w(100);
  const t0 = Date.now();
  ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
  await w(4000);
  const busy = () => document.querySelector(".think-working") || [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Stop");
  for (let i = 0; i < 600 && busy(); i++) {
    const allow = document.querySelector(".think-ask .think-button.primary");
    if (allow) allow.click();
    await w(1000);
  }
  await w(2500);
  const secs = Math.round((Date.now() - t0) / 1000);
  // A proposed edit or a first option is used, as a person would, so the file can be graded.
  if (__USE__) {
    const use = document.querySelector(".think-offer .think-button.primary");
    if (use) { use.click(); await w(3000); }
  }
  const replies = [...document.querySelectorAll(".think-message.agent")].map((x) => x.innerText);
  return { secs, reply: replies.join("\n\n"), steps: document.querySelectorAll(".think-tool").length };
})()
"""


def run_anur(task: dict, folder: str, use_edit: bool) -> tuple[str, dict]:
    probe = (
        PROBE.replace("__SECTION__", json.dumps(task["section"]))
        .replace("__MESSAGE__", json.dumps(task["anur"]))
        .replace("__USE__", "true" if use_edit else "false")
    )
    env = dict(
        os.environ,
        ANUR_OPEN_FOLDER=folder,
        ANUR_SCREENSHOT=os.path.join(folder, "..", os.path.basename(folder) + ".png"),
        ANUR_SCREENSHOT_CLICK="Launch,Map",
        ANUR_SCREENSHOT_PROBE=probe,
    )
    out = subprocess.run(
        ["pnpm", "exec", "electron", "."],
        cwd=os.path.join(REPO, "packages", "desktop"),
        env=env,
        capture_output=True,
        text=True,
        timeout=1200,
    )
    line = next((l for l in out.stdout.splitlines() if l.startswith("probe: ")), "probe: {}")
    r = json.loads(line[len("probe: ") :] or "{}")
    # Usage from the thread's own record.
    u = {"input": 0, "cacheRead": 0, "cacheWrite": 0, "output": 0}
    for root, _, names in os.walk(os.path.join(folder, ".anur")):
        if "/threads/" not in root:
            continue
        for n in names:
            for l in open(os.path.join(root, n), encoding="utf-8"):
                d = json.loads(l)
                if d.get("kind") == "turn" and d.get("event") == "end" and d.get("usage"):
                    for k in u:
                        u[k] += d["usage"].get(k, 0)
    return str(r.get("reply", "")), {**u, "steps": r.get("steps"), "secs": r.get("secs")}


def score(name: str, folder: str, reply: str) -> dict:
    if name == "email":
        return grade.email(folder)
    if name == "pricing":
        return grade.pricing(reply)
    return grade.risks(folder)


def main() -> None:
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    tasks = sys.argv[2].split(",") if len(sys.argv) > 2 else list(TASKS)
    setups = sys.argv[3].split(",") if len(sys.argv) > 3 else ["anur", "cc-fresh", "cc-long"]
    results = []
    stamp = datetime.datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    out_dir = os.path.join(HERE, "results")
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, f"{stamp}.json")
    for n in range(runs):
        for name in tasks:
            for setup in setups:
                base = tempfile.mkdtemp(prefix="anur-h2h-")
                folder = os.path.join(base, "vault")
                os.makedirs(folder)
                fixture.build(folder, big=BIG)
                if setup == "anur":
                    reply, usage = run_anur(TASKS[name], folder, use_edit=name == "risks")
                else:
                    reply, usage = run_cc(TASKS[name], folder, long_chat=setup == "cc-long")
                g = score(name, folder, reply)
                row = {"run": n, "task": name, "setup": setup, **g, "usage": usage, "reply": reply[:1500]}
                results.append(row)
                print(f"{n} {name:8} {setup:9} score {g['score']:.2f} wrong {g['wrong']} steps {usage.get('steps')} secs {usage.get('secs')}", flush=True)
                with open(out_file, "w", encoding="utf-8") as f:
                    json.dump(results, f, indent=1)
                shutil.rmtree(base, ignore_errors=True)
    print(out_file)


if __name__ == "__main__":
    main()
