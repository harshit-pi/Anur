/**
 * What Anur asks the person's agent for an action on a section (group 15;
 * Actions, "Build this section" and "Check this section"). Both run in the
 * mode the person picked, as any reply does: in plan mode the plan shows as a
 * card to approve, and Auto acts at once, as it would in Claude Code. The
 * Build button names the mode it will run in.
 */

export type Purpose = "build" | "check";

export function actionTitle(purpose: Purpose, section: string): string {
  return `${purpose === "build" ? "Build" : "Check"}: ${section}`;
}

export function actionPrompt(purpose: Purpose, section: string, note: string): string {
  const extra = note.trim() ? `\n\nThe person adds: ${note.trim()}` : "";
  if (purpose === "build")
    return (
      [
        `Build what the section "${section}" decides, with your own tools, as the person would by hand: files, drafts, tickets, code, whatever the section asks for.`,
        "",
        "If the section lays out several steps or phases, build the first one that fits one sitting, not all of them. If the section has no text of its own, build from what the doc under it decides, and say which part.",
        "",
        'Before your first tool call, write one line saying what you will build and what you are relying on, such as "Building: the launch email and FAQ. Relying on: beta.csv; no list of addresses in the folder." The person can stop you there if it is wrong.',
        "",
        "Build it. A new doc you write is kept in the folder as you make it; a change to an existing doc becomes a proposal the person decides on. A message to a person is a draft for them to send: never send it yourself. When you're done, report what you did (no progress notes), each change with its path relative to the folder (never a working copy's, never absolute) or link, then your guesses, each marked as a guess, then the section's remaining steps as next steps, if you built only one. Last, propose the section's text with a short line at its end saying it was built and where the work is, as an edit to your working copy.",
      ].join("\n") + extra
    );
  return (
    [
      `Check the section "${section}": test each claim it makes against what it links to or names, such as files, docs, code, data or pages. Read only; change nothing.`,
      "",
      "Then report with Anur's anur_report_check tool: every claim, whether it holds, is wrong, is unsupported (nothing to test it against) or is missing (something the sources say that the section should), with the source you checked, a one-line note, and whether it is about a fact or about wording (a spelling, grammar or format slip). If anything is wrong or missing, include the section's corrected text. The report shows as a table; your reply after it is two or three sentences on what matters most, not the claims again.",
    ].join("\n") + extra
  );
}
