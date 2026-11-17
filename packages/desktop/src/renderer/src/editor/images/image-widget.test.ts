import { describe, expect, it } from "vitest";
import { isImagePath, sizeOf, withWidth } from "./image-widget.ts";

describe("image embeds", () => {
  it("reads Obsidian's size after the bar", () => {
    expect(sizeOf("400")).toEqual({ width: 400, height: null });
    expect(sizeOf("400x300")).toEqual({ width: 400, height: 300 });
    expect(sizeOf("a caption")).toBeNull();
    expect(sizeOf(null)).toBeNull();
  });

  it("writes a new width into either kind of embed", () => {
    expect(withWidth("![[Peacock bookmark reference.webp]]", 412.4)).toBe(
      "![[Peacock bookmark reference.webp|412]]",
    );
    expect(withWidth("![[a.png|200]]", 300)).toBe("![[a.png|300]]");
    expect(withWidth("![logo](img/logo.png)", 120)).toBe("![logo|120](img/logo.png)");
    expect(withWidth("![logo|80](img/logo.png)", 120)).toBe("![logo|120](img/logo.png)");
    expect(withWidth("just text", 120)).toBeNull();
  });

  it("knows an image by its extension", () => {
    expect(isImagePath("a/b.WEBP")).toBe(true);
    expect(isImagePath("x.png?raw=1")).toBe(true);
    expect(isImagePath("Ideas.base")).toBe(false);
  });
});
