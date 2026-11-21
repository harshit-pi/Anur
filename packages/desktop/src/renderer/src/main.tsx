import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app.css";
import "./quiet.ts";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/source-serif-4/opsz-italic.css";
import { applyTheme, loadTheme } from "./regions/theme-pref.ts";
import { applyPageFont, followPageFont, loadPageFont } from "./regions/font-pref.ts";

applyTheme(loadTheme(window.localStorage));
applyPageFont(loadPageFont(window.localStorage));
followPageFont();

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
