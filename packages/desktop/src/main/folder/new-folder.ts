import { mkdir, stat } from "node:fs/promises";

/**
 * Make the folder a new set of docs starts in, as "New Folder…" asks. A
 * folder already there is used as it is; a file of that name is not.
 */
export async function makeStartFolder(
  full: string,
): Promise<{ kind: "made" } | { kind: "failed"; reason: string }> {
  try {
    await mkdir(full);
    return { kind: "made" };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") return { kind: "failed", reason: (e as Error).message };
  }
  const isFolder = await stat(full).then(
    (s) => s.isDirectory(),
    () => false,
  );
  return isFolder
    ? { kind: "made" }
    : { kind: "failed", reason: `There's already a file named that at ${full}.` };
}
