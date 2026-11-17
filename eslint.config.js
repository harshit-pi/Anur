import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// The one import boundary: core stays free of Electron, React and the file system,
// so it tests fast and the MCP server and later the sync server can reuse it.
const coreForbidden = [
  "electron",
  "react",
  "react-dom",
  "fs",
  "fs/promises",
  "node:fs",
  "node:fs/promises",
];

export default defineConfig(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/out/**", "**/coverage/**"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // `_name` marks a value left unused on purpose, such as a field dropped from a rest pattern.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: coreForbidden.map((name) => ({
            name,
            message: "core has no Electron, React or file system access; put this in desktop.",
          })),
          patterns: [
            {
              group: ["electron/*", "react/*", "react-dom/*"],
              message: "core has no Electron or React; put this in desktop.",
            },
          ],
        },
      ],
    },
  },
  {
    // The renderer is sandboxed with no Node: it reaches everything through the preload.
    files: ["packages/desktop/src/renderer/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["electron", "fs", "path", "child_process", "os", "crypto"].map((name) => ({
            name,
            message: "the renderer has no Node or Electron; ask main through window.anur.",
          })),
          patterns: [
            {
              group: ["node:*"],
              message: "the renderer has no Node; ask main through window.anur.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
