/**
 * What Anur asks the person's agent for an action on a section (group 15;
 * Actions, "Build this section" and "Check this section"). The agent starts
 * in its own plan mode, so it reads and plans before anything changes.
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
        "First plan, without changing anything: what you will read, what you will make or change and where, and what you will have to guess because the section doesn't say. Then present the plan for approval. Nothing runs before the person approves it.",
        "",
        "Once approved, build it. A new doc you write is kept in the folder as you make it; a change to an existing doc becomes a proposal the person decides on. A message to a person is a draft for them to send: never send it yourself. When you're done, reply with what you did, each change with its path in the folder (never a working copy's) or link, then your guesses, each marked as a guess. Last, propose the section's text with a short line at its end saying it was built and where the work is, as an edit to your working copy.",
      ].join("\n") + extra
    );
  return (
    [
      `Check the section "${section}": test each claim it makes against what it links to or names, such as files, docs, code, data or pages. Read only; change nothing.`,
      "",
      "Then report with Anur's anur_report_check tool: every claim, whether it holds, is wrong, is unsupported (nothing to test it against) or is missing (something the sources say that the section should), with the source you checked and a one-line note. If anything is wrong or missing, include the section's corrected text. The report shows as a table; your reply after it is two or three sentences on what matters most, not the claims again.",
    ].join("\n") + extra
  );
}
