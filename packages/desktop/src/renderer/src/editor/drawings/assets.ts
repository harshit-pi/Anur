/**
 * Where Excalidraw finds its fonts: beside the page, copied there at build
 * (electron.vite.config.ts), as a full URL; else it reaches for a CDN, which
 * the app's content policy blocks. Tests run without a window: nothing to set.
 */
if (typeof window !== "undefined")
  (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL(
    "./excalidraw/",
    window.location.href,
  ).href;
