import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readImage } from "./images.ts";
import { forgetWebImages, readWebImage, sniff } from "./web-images.ts";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
let server: Server;
let base = "";
let hits = 0;
let lastCookie: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    lastCookie = req.headers.cookie;
    if (req.url === "/a.png") res.writeHead(200, { "content-type": "image/png" }).end(PNG);
    else if (req.url === "/photo?w=400")
      res.writeHead(200, { "content-type": "image/jpeg; charset=binary" }).end(PNG);
    else if (req.url === "/vague.webp")
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(PNG);
    else if (req.url === "/photo")
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(PNG);
    else if (req.url === "/blob")
      res.writeHead(200, { "content-type": "application/octet-stream" }).end("plain words");
    else if (req.url === "/page.png")
      res.writeHead(200, { "content-type": "text/html" }).end("<p>");
    else if (req.url === "/moved.png") res.writeHead(302, { location: "/a.png" }).end();
    else if (req.url === "/huge.png")
      res
        .writeHead(200, { "content-type": "image/png", "content-length": String(30 * 1024 * 1024) })
        .end();
    else res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  forgetWebImages();
  hits = 0;
});

describe("web images (2.28)", () => {
  it("fetches an image into a data URL, through readImage, without cookies", async () => {
    const r = await readImage("/nowhere", `${base}/a.png`, "Doc.md");
    expect(r).toEqual({
      kind: "image",
      path: `${base}/a.png`,
      dataUrl: `data:image/png;base64,${PNG.toString("base64")}`,
    });
    expect(lastCookie).toBeUndefined();
  });

  it("takes the type from the server, or from the extension when the server is vague", async () => {
    const photo = await readWebImage(`${base}/photo?w=400`);
    expect(photo.kind === "image" && photo.dataUrl.startsWith("data:image/jpeg;")).toBe(true);
    const vague = await readWebImage(`${base}/vague.webp`);
    expect(vague.kind === "image" && vague.dataUrl.startsWith("data:image/webp;")).toBe(true);
  });

  it("knows an image by its first bytes when neither the server nor the address says", async () => {
    const photo = await readWebImage(`${base}/photo`);
    expect(photo.kind === "image" && photo.dataUrl.startsWith("data:image/png;")).toBe(true);
    expect((await readWebImage(`${base}/blob`)).kind).toBe("failed");
    expect(sniff(Buffer.from("  <?xml version='1.0'?><svg xmlns='x'/>"))).toBe("image/svg+xml");
    expect(sniff(Buffer.from("ffd8ffe0", "hex"))).toBe("image/jpeg");
  });

  it("follows a redirect", async () => {
    expect((await readWebImage(`${base}/moved.png`)).kind).toBe("image");
  });

  it("refuses what isn't an image, a missing one and one over 25 MB", async () => {
    expect(await readWebImage(`${base}/page.png`)).toEqual({
      kind: "failed",
      reason: expect.stringContaining("isn't an image") as string,
    });
    expect(await readWebImage(`${base}/gone.png`)).toEqual({
      kind: "failed",
      reason: expect.stringContaining("404") as string,
    });
    expect(await readWebImage(`${base}/huge.png`)).toEqual({
      kind: "failed",
      reason: expect.stringContaining("25 MB") as string,
    });
  });

  it("says when the host can't be reached", async () => {
    const r = await readWebImage("http://127.0.0.1:1/a.png");
    expect(r).toEqual({
      kind: "failed",
      reason: expect.stringContaining("Couldn't reach") as string,
    });
  });

  it("fetches each image once per session, even when asked twice at once", async () => {
    await Promise.all([readWebImage(`${base}/a.png`), readWebImage(`${base}/a.png`)]);
    await readWebImage(`${base}/a.png`);
    expect(hits).toBe(1);
  });

  it("tries a failed image again next time", async () => {
    await readWebImage(`${base}/gone.png`);
    await readWebImage(`${base}/gone.png`);
    expect(hits).toBe(2);
  });

  it("draws no other kind of address", async () => {
    expect(await readImage("/nowhere", "file:///etc/hosts.png", "Doc.md")).toEqual({
      kind: "failed",
      reason: "Only images in this folder or on the web are drawn.",
    });
  });
});
