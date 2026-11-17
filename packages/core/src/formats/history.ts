import { z } from "zod";
import { PreviewId, ThreadId } from "../ids.ts";
import { LineEnvelope } from "../jsonl/lines.ts";

/**
 * `docs/<doc>/history/<section>/<device>.jsonl` (task 1.9): one version of a
 * section per line, with its full text, so any version restores on its own
 * and a device whose files arrive late simply fills its versions in.
 */
export const VersionCause = z.enum([
  "start", //   the text when Anur first opened the doc or a thread began on it
  "typing", //  one editing session
  "apply", //   a preview applied; written before the Apply lands
  "restore", // an older version restored
  "outside", // a change made outside Anur, such as a pull or another editor
]);
export type VersionCause = z.infer<typeof VersionCause>;

export const VersionLine = LineEnvelope.extend({
  kind: z.literal("version"),
  cause: VersionCause,
  /** The section's full subtree text in this version. */
  text: z.string(),
  /** The heading path at the time, so a version reads well after a rename. */
  path: z.array(z.string()).min(1),
  /** One line on what changed. */
  summary: z.string(),
  /** For an Apply: the preview and its thread, so the reasoning behind the text is one click away. */
  preview: PreviewId.nullable(),
  thread: ThreadId.nullable(),
});
export type VersionLine = z.infer<typeof VersionLine>;

/**
 * An Apply's version line is written first; after a crash, Anur checks the
 * section on disk and records what happened (Architecture, "Crash recovery").
 */
export const ApplyResultLine = LineEnvelope.extend({
  kind: z.literal("apply-result"),
  preview: PreviewId,
  result: z.enum(["landed", "abandoned", "outside"]),
});
export type ApplyResultLine = z.infer<typeof ApplyResultLine>;

export const HistoryLine = z
  .discriminatedUnion("kind", [VersionLine, ApplyResultLine])
  .superRefine((l, ctx) => {
    if (l.kind === "version" && (l.cause === "apply") !== (l.preview !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "an Apply version, and only one, names its preview",
      });
    }
  });
export type HistoryLine = z.infer<typeof HistoryLine>;
