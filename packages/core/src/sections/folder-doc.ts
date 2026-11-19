/**
 * The whole folder as a doc: a thread about everything in the folder rather
 * than one section has a section to hang on, as the system map's boxes do
 * (29.1). It's never written to disk; its one section is the folder, and its
 * text lists the folder's docs so the agent knows what's there.
 */

/** The virtual doc's path; no file in a folder can have it. */
export const FOLDER_DOC = "Anur folder.anur-folder";

/** Docs listed by name; past this many, a count. */
const LISTED = 300;

/** The folder's doc: its name as the one heading, then its docs by path. */
export function folderDocText(name: string, docs: readonly string[]): string {
  const shown = docs.slice(0, LISTED);
  return [
    `# ${name.replace(/\n/g, " ") || "This folder"}`,
    "",
    "A thread here is about the whole folder, not one doc. Its docs:",
    "",
    ...shown.map((d) => `- ${d}`),
    ...(docs.length > shown.length ? [`- and ${String(docs.length - shown.length)} more`] : []),
    "",
  ].join("\n");
}
