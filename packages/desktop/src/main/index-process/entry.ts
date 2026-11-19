import { sectionsFor } from "./sections.ts";
import type { FromIndex, ToIndex } from "./protocol.ts";

/**
 * The index process (Architecture, "Processes"; Internals §2): a utilityProcess
 * where plugins read the folder, so a scan of many repos never freezes main.
 */
const port = process.parentPort;
port.on("message", (e: { data: ToIndex }) => {
  const m = e.data;
  sectionsFor(m.folder, m.plugins, (folder) => {
    port.postMessage({ type: "changed", folder } satisfies FromIndex);
  }).then(
    (read) => {
      port.postMessage({ type: "sections", id: m.id, read } satisfies FromIndex);
    },
    (err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      port.postMessage({ type: "failed", id: m.id, reason } satisfies FromIndex);
    },
  );
});
