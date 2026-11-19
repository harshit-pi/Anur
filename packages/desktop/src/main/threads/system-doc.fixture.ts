import type { SystemShape } from "./system-doc.ts";

/** Two repos and a line between them, as the system map reads them. */
export const boxes = [
  { id: "repo:api1", path: ["api"], text: "acme/api", parent: null },
  {
    id: "part:chk",
    path: ["api", "Checkout"],
    text: "stack in api/bin/app.ts",
    parent: "repo:api1",
  },
  { id: "repo:web1", path: ["web"], text: "acme/web", parent: null },
];
export const shape: SystemShape = {
  parents: new Map(boxes.map((b) => [b.id, b.parent] as const)),
  repoDir: new Map([
    ["repo:api1", "api"],
    ["part:chk", "api"],
    ["repo:web1", "web"],
  ]),
  names: new Map(boxes.map((b) => [b.id, b.path.at(-1) ?? b.id] as const)),
  dirs: new Map([["part:chk", "api/bin"]]),
  edges: [
    {
      id: "web/|api/|http|/v1/checkout",
      from: "repo:web1",
      to: "part:chk",
      label: "POST /v1/checkout",
    },
  ],
};
