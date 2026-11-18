import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, dialog } from "electron";

/**
 * Opened from the disk image or Downloads: offer to move Anur into
 * Applications, where it stays put and can update itself. Move copies it
 * there and opens that copy; Not Now asks again next time unless "Don't ask
 * again" was ticked.
 */
export async function offerMoveToApplications(): Promise<void> {
  if (process.platform !== "darwin" || app.isInApplicationsFolder()) return;
  const file = path.join(app.getPath("userData"), "move-to-applications.json");
  const declined = await readFile(file, "utf8").then(
    (t) => (JSON.parse(t) as { never?: boolean }).never === true,
    () => false,
  );
  if (declined) return;
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: "question",
    message: "Move Anur to your Applications folder?",
    detail: "Anur works best from Applications, where it can keep itself up to date.",
    buttons: ["Move to Applications", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't ask again",
  });
  if (response === 0) {
    try {
      // Replaces an older Anur already there, and opens the moved copy.
      app.moveToApplicationsFolder({ conflictHandler: () => true });
    } catch (e) {
      await dialog.showMessageBox({
        type: "warning",
        message: "Anur couldn't move itself",
        detail: `Drag Anur into Applications in Finder instead. (${(e as Error).message})`,
      });
    }
    return;
  }
  if (checkboxChecked) await writeFile(file, JSON.stringify({ never: true }));
}
