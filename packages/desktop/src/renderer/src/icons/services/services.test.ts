import { describe, expect, it } from "vitest";
import { serviceOf } from "./index.tsx";

describe("the service a step acts in", () => {
  it("reads it from the tool's name, with a mark where one exists", () => {
    const linear = serviceOf("mcp__claude_ai_Linear__save_issue");
    expect(linear).toMatchObject({ name: "Linear", action: "save issue" });
    expect(linear?.mark?.title).toBe("Linear");
    expect(serviceOf("mcp__claude_ai_Gmail__create_draft")?.mark?.title).toBe("Gmail");
  });

  it("names a service with no mark, so it gets the plain action mark", () => {
    const slack = serviceOf("mcp__claude_ai_Slack__slack_send_message");
    expect(slack).toMatchObject({ name: "Slack", mark: null, action: "send message" });
    expect(serviceOf("mcp__acme__do_thing")).toMatchObject({ name: "Acme", mark: null });
  });

  it("leaves Anur's own tools and plain steps alone", () => {
    expect(serviceOf("mcp__anur__anur_offer_options")).toBeNull();
    expect(serviceOf("Read notes.md")).toBeNull();
  });
});
