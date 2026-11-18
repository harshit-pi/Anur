import { describe, expect, it } from "vitest";
import { pageText, readLink } from "./read-link.ts";

describe("a link a person added", () => {
  it("reads a page as its words, without scripts or tags", () => {
    expect(
      pageText(
        "<html><head><style>p{}</style><script>evil()</script></head><body><h1>Spec</h1><p>Ship &amp; test.</p></body></html>",
      ),
    ).toBe("Spec\n Ship & test.");
  });

  it("says why when a page can't be read", async () => {
    const notFound = (() => Promise.resolve(new Response("nope", { status: 404 }))) as typeof fetch;
    expect(await readLink("https://example.com/x", notFound)).toEqual({
      error: "https://example.com/x answered 404.",
    });
    const image = (() =>
      Promise.resolve(
        new Response("x", { status: 200, headers: { "content-type": "image/png" } }),
      )) as typeof fetch;
    expect(await readLink("https://example.com/x.png", image)).toEqual({
      error: "https://example.com/x.png isn't a page of text (image/png).",
    });
  });
});
