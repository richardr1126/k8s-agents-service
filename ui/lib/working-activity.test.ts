import { describe, expect, it } from "vitest";
import { activityOf } from "./working-activity";

describe("activityOf", () => {
  it("is null when no tool is running", () => {
    expect(activityOf([{ type: "text", text: "hi" }])).toBeNull();
    expect(activityOf([{ type: "tool-call", toolName: "web_search", result: "done" }])).toBeNull();
  });

  it("names a running tool", () => {
    expect(activityOf([{ type: "tool-call", toolName: "web_search" }])).toBe("Searching the web");
    expect(activityOf([{ type: "tool-call", toolName: "get_weather" }])).toBe("Running get weather");
  });

  it("names the sub-agent, or what it is doing", () => {
    const task = { type: "tool-call", toolName: "task", args: { subagent_type: "web" } };
    expect(activityOf([{ ...task, messages: [{ content: [] }] }])).toBe("Asking the web research agent");
    expect(
      activityOf([{ ...task, messages: [{ content: [{ type: "tool-call", toolName: "resume_search" }] }] }]),
    ).toBe("Searching the resume");
  });
});

describe("activityOf for assistant sub-agents", () => {
  it("names the focus", () => {
    const task = { type: "tool-call", toolName: "task", args: { focus: "github", description: "x" } };
    expect(activityOf([task])).toBe("Asking the github agent");
  });
});

describe("activityOf before the arguments arrive", () => {
  it("doesn't name an unknown sub-agent", () => {
    expect(activityOf([{ type: "tool-call", toolName: "task", args: {} }])).toBe("Starting a sub-agent");
  });
});
