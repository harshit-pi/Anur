import path from "node:path";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, type ImageOutcome } from "./images.ts";

/**
 * An image a doc embeds from the web (task 2.28), `![](https://…)`. The page
 * is sandboxed and never fetches; main does, with no cookies, and hands the
 * bytes over as a data URL, as for a local image. Drawn images are kept for
 * the session, so a window coming to the front doesn't fetch them again.
 */

const TIMEOUT_MS = 15_000;
/** All kept images together stay under this; the oldest go first. */
const CACHE_BYTES = 100 * 1024 * 1024;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const kept = new Map<string, { outcome: ImageOutcome; bytes: number }>();
const pending = new Map<string, Promise<ImageOutcome>>();

export const isWebAddress = (target: string) => /^https?:\/\//i.test(target);

function keep(url: string, outcome: ImageOutcome, bytes: number) {
  kept.set(url, { outcome, bytes });
  let total = 0;
  for (const v of kept.values()) total += v.bytes;
  for (const [k, v] of kept) {
    if (total <= CACHE_BYTES) break;
    kept.delete(k);
    total -= v.bytes;
  }
}

const VAGUE = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/** The image type a file's first bytes give away, for servers that don't say. */
export function sniff(bytes: Buffer): string | null {
  const hex = bytes.subarray(0, 12).toString("hex");
  const ascii = bytes.subarray(0, 256).toString("latin1").trimStart().toLowerCase();
  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("47494638")) return "image/gif";
  if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") return "image/webp";
  if (hex.slice(8, 24) === "6674797061766966") return "image/avif";
  if (hex.startsWith("424d")) return "image/bmp";
  if (ascii.startsWith("<svg") || (ascii.startsWith("<?xml") && ascii.includes("<svg")))
    return "image/svg+xml";
  return null;
}

/** The image type the server gives; when it's vague, the address's extension, then the bytes. */
function typeOf(header: string | null, url: URL, bytes: Buffer): string | null {
  const type = header?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.startsWith("image/")) return type;
  if (!VAGUE.has(type)) return null;
  return IMAGE_TYPES[path.posix.extname(url.pathname).toLowerCase()] ?? sniff(bytes);
}

/** Read the body, stopping once it passes the size limit. */
async function readCapped(res: Response): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function fetchOnce(address: string, fetchImpl: Fetch): Promise<ImageOutcome> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { kind: "failed", reason: `${address} isn't a web address.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { kind: "failed", reason: "Only http and https images are drawn." };
  let res: Response;
  try {
    res = await fetchImpl(url.href, {
      redirect: "follow",
      credentials: "omit",
      headers: { accept: "image/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = (e as Error).name === "TimeoutError";
    return {
      kind: "failed",
      reason: timedOut
        ? `${url.host} took too long to send the image.`
        : `Couldn't reach ${url.host}; check the connection.`,
    };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { kind: "failed", reason: `${url.host} answered ${String(res.status)} for this image.` };
  }
  const header = res.headers.get("content-type");
  const plainly = header?.split(";")[0]?.trim().toLowerCase() ?? "";
  const notImage = {
    kind: "failed" as const,
    reason: `${url.host} sent something that isn't an image.`,
  };
  if (!plainly.startsWith("image/") && !VAGUE.has(plainly)) {
    await res.body?.cancel();
    return notImage;
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  const bytes = declared > MAX_IMAGE_BYTES ? null : await readCapped(res);
  if (!bytes)
    return { kind: "failed", reason: "This image is over 25 MB, so it's shown as its address." };
  const type = typeOf(header, url, bytes);
  if (!type) return notImage;
  const outcome: ImageOutcome = {
    kind: "image",
    path: url.href,
    dataUrl: `data:${type};base64,${bytes.toString("base64")}`,
  };
  keep(url.href, outcome, bytes.length);
  return outcome;
}

/** Fetch a web image once per session; a failure is tried again next time it's asked for. */
export function readWebImage(address: string, fetchImpl: Fetch = fetch): Promise<ImageOutcome> {
  const known = kept.get(address);
  if (known) return Promise.resolve(known.outcome);
  const running = pending.get(address);
  if (running) return running;
  const next = fetchOnce(address, fetchImpl).finally(() => pending.delete(address));
  pending.set(address, next);
  return next;
}

/** For tests: forget kept images. */
export function forgetWebImages() {
  kept.clear();
}
