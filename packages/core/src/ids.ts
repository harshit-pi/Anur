import { z } from "zod";

/**
 * IDs that name files and folders in `.anur/` share the safe-name rule of the
 * layout, so an ID read from a synced file can never climb out of its folder.
 */
const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** A thread: one discussion on one section, one folder of per-device files. */
export const ThreadId = z.string().regex(SAFE).brand<"ThreadId">();
export type ThreadId = z.infer<typeof ThreadId>;

/** A preview: one thread's proposed text for one doc. */
export const PreviewId = z.string().regex(SAFE).brand<"PreviewId">();
export type PreviewId = z.infer<typeof PreviewId>;

/** A device: one install of Anur (task 1.10 makes it). */
export const DeviceId = z.string().regex(SAFE).brand<"DeviceId">();
export type DeviceId = z.infer<typeof DeviceId>;

/** A snapshot's name in `.anur/snapshots/`: the SHA-256 of its bytes, in hex. */
export const SnapshotHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<"SnapshotHash">();
export type SnapshotHash = z.infer<typeof SnapshotHash>;
