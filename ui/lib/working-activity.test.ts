import { describe, expect, it } from "vitest";
import { activityOf } from "./working-activity";
import { CATALOG } from "./test-catalog";

const run = (command: string) => ({ type: "tool-call", toolName: "run", args: { command } });

describe("activityOf", () => {
  it("is null when no tool is running", () => {
    expect(activityOf([{ type: "text", text: "hi" }])).toBeNull();
    expect(activityOf([{ ...run("web search x"), result: "done" }], CATALOG)).toBeNull();
  });

  it("names a command by its activity in the catalog", () => {
    expect(activityOf([run("web search 'k3s ingress'")], CATALOG)).toBe("Searching the web");
    expect(activityOf([run("github repo view openreader")], CATALOG)).toBe("Reading a README");
    expect(activityOf([run("github commits openreader --bg")], CATALOG)).toBe("Reading commits");
  });

  it("falls back to the command's words", () => {
    expect(activityOf([run("papers podcast rag")], CATALOG)).toBe("Running papers podcast");
    expect(activityOf([run("web search x")])).toBe("Running web search");
  });

  it("names older tools the same way", () => {
    expect(activityOf([{ type: "tool-call", toolName: "web_search", args: { query: "x" } }], CATALOG)).toBe("Searching the web");
    expect(activityOf([{ type: "tool-call", toolName: "run_workflow", args: { workflow: "papers.search" } }], CATALOG)).toBe(
      "Searching arXiv",
    );
    expect(activityOf([{ type: "tool-call", toolName: "get_weather" }])).toBe("Running get weather");
  });
});

describe("activityOf for sub-agents", () => {
  it("names the sub-agent, or what it is doing", () => {
    const task = { type: "tool-call", toolName: "task", args: { subagent_type: "web" } };
    expect(activityOf([{ ...task, messages: [{ content: [] }] }])).toBe("Asking the web research agent");
    expect(activityOf([{ ...task, messages: [{ content: [{ type: "tool-call", toolName: "resume_search" }] }] }])).toBe(
      "Searching the resume",
    );
  });

  it("reads an agent command as it streams in", () => {
    expect(activityOf([run("agent")], CATALOG)).toBe("Starting a sub-agent");
    expect(activityOf([run("agent <<'EOF'\nfind it")], CATALOG)).toBe("Asking a sub-agent");
    expect(activityOf([run("agent --type github <<'EOF'\nx\nEOF")], CATALOG)).toBe("Asking the github agent");
    const nested = { ...run("agent --type papers <<'EOF'\nx\nEOF"), messages: [{ content: [run("papers search rag")] }] };
    expect(activityOf([nested], CATALOG)).toBe("Searching arXiv");
  });
});
