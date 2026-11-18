"""
The head-to-head eval's folder (16.5): a small vault with traps.

- Rules for the work live elsewhere: house rules in the doc's title section,
  an email spec in another doc the section links, a currency rule in a
  parent section.
- Stale facts sit beside current ones: an archive note with last year's
  competitor prices.
- Fifteen unrelated idea docs, some with rules of their own that would be
  wrong here (another product's sign-off, American spelling).
"""

import os
import textwrap

LAUNCH = textwrap.dedent(
    """\
    # Tally launch plan

    Tally is a bill-splitting app for shared flats.

    House rules for everything written from this plan: British spelling (organise, prioritise, colour). No exclamation marks. Never name a competitor in customer-facing copy.

    ## Launch email

    Write the email we send our beta flats on Product Hunt day, following [[Email spec#Rules]]. Put it in launch-email.md.

    ## Pricing

    Free for up to 3 people in a flat. The paid plan is £3 a month per flat. Splitwise Pro costs £5 a month, so we are cheaper. We have 40 beta flats signed up (see beta.csv).

    ## Plan

    Every section under Plan keeps to three bullets at most.

    ### Risks

    - Flatmates may not all install the app, so one holdout breaks the shared balance.
    - We need to prioritize the Android build, since half the beta flats use Android.
    - Splitwise is free and well known, so switching costs feel high.
    - We have not organized a support rota for launch week.
    - The colour scheme tests poorly with older users.
    - Product Hunt traffic may spike and slow the sign-up flow.
    """
)

EMAIL_SPEC = textwrap.dedent(
    """\
    # Email spec

    ## Rules

    - Subject line: exactly "Tally is live on Product Hunt".
    - Exactly three bullet points in the body.
    - Never mention the price.
    - Sign off: "Cheers, Maya from Tally".

    ## History

    Version 1 signed off "Best, the Tally team"; we dropped it in October.
    """
)

COMPETITORS = textwrap.dedent(
    """\
    Competitor prices, checked 2026-11-01
    Splitwise Pro: £2.99 a month
    Tricount: free
    Settle Up: free, Premium £1.49 a month
    """
)

ARCHIVE = textwrap.dedent(
    """\
    # Competitor prices (2025, archived)

    Checked 2025-06-01; superseded by competitors.txt.

    - Splitwise Pro: £5 a month
    - Tricount: £1 a month
    """
)

IDEAS = [
    ("Garden share", 'Emails to members sign off "Best, Sam". Prices in dollars: $4 a month.'),
    ("Recipe swap", "Use American spelling throughout: color, organize, prioritize."),
    ("Bike lockers", "Each section may have up to ten bullets."),
    ("Tool library", "Competitor: ShareShed costs $5 a month."),
    ("Study rooms", 'Subject lines start with "Exciting news!"'),
    ("Plant sitter", "We have 400 beta users."),
    ("Ride pool", "Mention the price in every email."),
    ("Book circle", "Sign off emails with \"Warmly, Jo\"."),
    ("Pet walkers", "Splitwise Pro costs £7 a month, per our 2024 notes."),
    ("Meal kits", "Three bullets is too few; aim for five."),
    ("Laundry slots", "Exclamation marks are encouraged in launch copy!"),
    ("Coffee club", "Free for up to 10 people."),
    ("Desk booking", "Launch on a Monday."),
    ("Parcel lockers", "Name competitors directly to show we are better."),
    ("Noise tracker", "Use plain language; no jargon."),
]


FILLER_TOPICS = [
    "Onboarding flow", "Referral scheme", "Support macros", "Analytics events", "App Store copy",
    "Press list", "Partnership ideas", "Accessibility audit", "Localisation", "Data retention",
    "Billing edge cases", "Push notifications", "Settings screen", "Empty states", "Error messages",
    "Offline mode", "Group invites", "Receipts scanning", "Currency handling", "Recurring bills",
    "Reminders", "Dark mode", "Widgets", "Export to CSV", "Account deletion",
    "Fraud checks", "Pricing experiments", "Landlord pilot", "University pilot", "Ambassador programme",
    "Community forum", "Blog plan", "SEO", "Paid social", "Podcast ads",
    "Customer interviews", "NPS survey", "Churn analysis", "Roadmap Q1", "Hiring plan",
]


def filler(topic: str) -> str:
    """A long, plausible section with no rules for the tasks: what a real plan holds."""
    lines = [f"## {topic}", ""]
    for i in range(1, 13):
        lines.append(
            f"- Note {i} on {topic.lower()}: owner to be agreed; draft by week {i % 6 + 1}; "
            f"depends on the beta feedback themes and the launch-week capacity review."
        )
    lines += ["", f"Open questions on {topic.lower()} are tracked in the weekly review.", ""]
    for i in range(1, 40):
        lines.append(f"{topic} detail line {i}: keep notes short and link evidence where it exists.")
    lines.append("")
    return "\n".join(lines)


def long_launch() -> str:
    """Launch.md padded to about 2,500 lines, the task sections near the end."""
    head, rest = LAUNCH.split("## Launch email", 1)
    return head + "".join(filler(t) + "\n" for t in FILLER_TOPICS) + "## Launch email" + rest


def build(folder: str, big: bool = False) -> None:
    os.makedirs(os.path.join(folder, "specs"), exist_ok=True)
    os.makedirs(os.path.join(folder, "Archive"), exist_ok=True)
    os.makedirs(os.path.join(folder, "Ideas"), exist_ok=True)
    files = {
        "Launch.md": long_launch() if big else LAUNCH,
        "specs/Email spec.md": EMAIL_SPEC,
        "competitors.txt": COMPETITORS,
        "Archive/Competitor prices 2025.md": ARCHIVE,
        "beta.csv": "flat,city\n" + "".join(f"Flat {i},London\n" for i in range(1, 28)),
    }
    for name, rule in IDEAS:
        files[f"Ideas/{name}.md"] = f"# {name}\n\n## Notes\n\n{rule}\n\n## Status\n\nParked.\n"
    for rel, text in files.items():
        with open(os.path.join(folder, rel), "w", encoding="utf-8") as f:
            f.write(text)
