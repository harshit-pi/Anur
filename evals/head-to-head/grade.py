"""
Graders for the head-to-head eval (16.5): each check is a rule from the
fixture, scored by script, never by eye. A task's score is the share of its
checks that pass; `wrong` counts a stale or foreign fact used as if current.
"""

import os
import re


def _section(text: str, heading: str) -> str:
    """A section's text by its heading line, up to the next heading of its level or above."""
    lines = text.split("\n")
    out: list[str] = []
    level = None
    for line in lines:
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m and level is None and m.group(2).strip() == heading:
            level = len(m.group(1))
            out.append(line)
            continue
        if level is not None:
            if m and len(m.group(1)) <= level:
                break
            out.append(line)
    return "\n".join(out)


def email(folder: str) -> dict:
    """Task 1: the launch email, against the spec and the house rules."""
    path = os.path.join(folder, "launch-email.md")
    if not os.path.exists(path):
        return {"score": 0.0, "checks": {"made": False}, "wrong": 0}
    text = open(path, encoding="utf-8").read()
    bullets = [l for l in text.split("\n") if re.match(r"^\s*[-*•]\s+\S", l)]
    checks = {
        "made": True,
        "subject": "Tally is live on Product Hunt" in text,
        "three_bullets": len(bullets) == 3,
        "no_price": not re.search(r"£\s?\d|\$\s?\d|\bprice\b|a month", text, re.I),
        "sign_off": "Cheers, Maya from Tally" in text,
        "no_exclamation": "!" not in text.replace("[!", ""),
        "no_competitor": not re.search(r"splitwise|tricount|settle up", text, re.I),
        "british": not re.search(r"\b(organiz|prioritiz|color\b)", text, re.I),
    }
    wrong = sum(
        [
            "Best, Sam" in text,
            "Warmly, Jo" in text,
            "Best, the Tally team" in text,
            "Exciting news" in text,
        ]
    )
    passed = sum(v for k, v in checks.items() if k != "made")
    return {"score": passed / (len(checks) - 1), "checks": checks, "wrong": wrong}


def pricing(reply: str) -> dict:
    """Task 2: is the pricing claim right? It isn't: £2.99 now, and 27 flats."""
    r = reply.lower()
    checks = {
        "current_price": "2.99" in r,
        "says_not_cheaper": bool(
            re.search(
                r"not cheaper|isn.t cheaper|rather than cheaper|not less|more expensive|dearer"
                r"|1p more|slightly more|costs more|not true|wrong|incorrect",
                r,
            )
        ),
        "flats_27": "27" in r,
    }
    # The archive's £5, or another doc's £7, taken as the current price: quoting
    # the doc's claim to correct it, or naming the archive, doesn't count.
    stale = bool(re.search(r"splitwise pro (?:is|costs|at) £?(5|7)\b", r))
    corrected = bool(re.search(r"archiv|2025|out of date|the section says|the claim", r))
    wrong = int(stale and not corrected) + int("400" in r)
    return {"score": sum(checks.values()) / len(checks), "checks": checks, "wrong": wrong}


def risks(folder: str) -> dict:
    """Task 3: Risks tightened under Plan's three-bullet rule and the house rules."""
    text = open(os.path.join(folder, "Launch.md"), encoding="utf-8").read()
    sec = _section(text, "Risks")
    bullets = [l for l in sec.split("\n") if re.match(r"^\s*[-*•]\s+\S", l)]
    body = "\n".join(sec.split("\n")[1:]).lower()
    checks = {
        "changed": "support rota" not in body or len(bullets) <= 3,
        "max_three": 0 < len(bullets) <= 3,
        "british": not re.search(r"\b(organiz|prioritiz|color\b)", body),
        "no_exclamation": "!" not in body,
        "keeps_install": "install" in body,
    }
    wrong = int(len(bullets) > 5)
    return {"score": sum(checks.values()) / len(checks), "checks": checks, "wrong": wrong}
