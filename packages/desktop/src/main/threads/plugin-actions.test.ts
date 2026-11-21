import { describe, expect, it } from "vitest";
import {
  checkAction,
  pluginContext,
  pushesByHand,
  turnPushed,
  type StandardPlugin,
} from "./plugin-actions.ts";

const git: StandardPlugin = {
  id: "git",
  name: "Git",
  what: "Put this folder on GitHub and keep it in sync.",
  status: "Synced 3m ago",
  actions: [
    { id: "createRepo", label: "Create private repo on GitHub" },
    { id: "syncNow", label: "Sync now" },
  ],
};

describe("the folder's plugins in a thread's context", () => {
  it("says nothing when no plugin is on", () => {
    expect(pluginContext([])).toBeNull();
  });

  it("names each plugin, its status and the actions an agent may run", () => {
    const c = pluginContext([git]);
    expect(c?.lines).toHaveLength(1);
    expect(c?.lines[0]).toContain("Now: Synced 3m ago.");
    expect(c?.lines[0]).toContain("syncNow (Sync now)");
    expect(c?.lines[0]).toContain(".anur/ included");
  });

  it("tells only the Git plugin's agents to push through it", () => {
    const other = { ...git, id: "calendar", name: "Calendar" };
    expect(pluginContext([other])?.lines[0]).not.toContain("git push");
  });
});

describe("an agent's plugin action", () => {
  it("runs a declared action of a plugin that's on, by its ID or name", () => {
    expect(checkAction([git], { plugin: "git", action: "syncNow" })).toMatchObject({
      action: "syncNow",
    });
    expect(checkAction([git], { plugin: "Git", action: "createRepo" })).toMatchObject({
      action: "createRepo",
    });
  });

  it("refuses a plugin that isn't on, an undeclared action, and nothing named", () => {
    expect(checkAction([], { plugin: "git", action: "syncNow" })).toEqual({
      error: "No plugins are on in this folder.",
    });
    expect(checkAction([git], { plugin: "calendar", action: "syncNow" })).toHaveProperty("error");
    // Continue anyway in iCloud is the person's call, so it's never offered.
    expect(checkAction([git], { plugin: "git", action: "continueInICloud" })).toHaveProperty(
      "error",
    );
    expect(checkAction([git], null)).toHaveProperty("error");
  });
});

describe("a push by hand", () => {
  it("is seen in the ways an agent writes it", () => {
    for (const cmd of [
      "git push",
      "git push -u origin main",
      "cd /x && git add -A && git commit -m x && git push",
      "git -C /Users/me/Folder push origin main",
      "GIT_SSH_COMMAND=ssh git push",
      "gh repo create AnurCore --private --source . --push",
    ])
      expect(pushesByHand(cmd), cmd).toBe(true);
  });

  it("isn't anything else", () => {
    for (const cmd of [
      "git status",
      "git commit -m 'push the docs'",
      "git log --grep push",
      "echo git push",
      "gh repo create AnurCore --private --source .",
      "gh pr create --title 'push'",
      "git pull",
    ])
      expect(pushesByHand(cmd), cmd).toBe(false);
  });

  it("is found among a turn's tool calls", () => {
    expect(turnPushed([{ input: { file_path: "a.md" } }, { input: { command: "git push" } }])).toBe(
      true,
    );
    expect(turnPushed([{ input: { command: "git status" } }, { input: null }, {}])).toBe(false);
    expect(
      turnPushed([
        { name: "mcp__anur__anur_plugin_action", input: { plugin: "git", action: "syncNow" } },
      ]),
    ).toBe(true);
    expect(
      turnPushed([
        { name: "mcp__anur__anur_plugin_action", input: { plugin: "calendar", action: "x" } },
      ]),
    ).toBe(false);
  });
});
