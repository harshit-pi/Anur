import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app.css";
import { applyTheme, loadTheme } from "./regions/theme-pref.ts";

applyTheme(loadTheme(window.localStorage));

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
