import { describe, expect, it } from "vitest";
import { callTitle, commandOf, describeCall, splitCommand } from "./commands";
import { CATALOG } from "./test-catalog";

describe("splitCommand", () => {
  it("splits words like a shell and reads --bg", () => {
    expect(splitCommand(`web search 'k3s "ingress"' -n 5 --bg`)).toEqual({
      words: ["web", "search", 'k3s "ingress"', "-n", "5"],
      input: null,
      background: true,
    });
  });

  it("keeps a heredoc's text as written, and words after its marker", () => {
    const line = splitCommand("agent <<'EOF' --type research\nfind $HOME\n  indented\nEOF");
    expect(line.words).toEqual(["agent", "--type", "research"]);
    expect(line.input).toBe("find $HOME\n  indented");
  });

  it("reads a heredoc still streaming in", () => {
    expect(splitCommand("agent --type web <<'EOF'\nhalf a bri").input).toBe("half a bri");
    expect(splitCommand("agent <<'EO").words[0]).toBe("agent");
  });

  it("doesn't take quoted angle brackets for a heredoc", () => {
    expect(splitCommand("web search 'a <<EOF b'").words).toEqual(["web", "search", "a <<EOF b"]);
  });
});

describe("describeCall", () => {
  it("finds the longest command in the catalog", () => {
    const call = describeCall("run", { command: "github repo view openreader" }, CATALOG)!;
    expect(call.workflow?.id).toBe("github repo view");
    expect(call.rest).toEqual(["openreader"]);
    expect(callTitle(call)).toEqual({ label: "GitHub repo view", detail: "openreader" });
  });

  it("reads an agent command and a stored task call alike", () => {
    const live = describeCall("run", { command: "agent --type research --thread r-1 <<'EOF'\ndig\nEOF" }, CATALOG);
    expect(live?.agent).toEqual({ brief: "dig", type: "research", thread: "r-1" });
    const stored = describeCall("task", { description: "dig", subagent_type: "research", thread_id: "r-1" }, CATALOG);
    expect(stored?.agent).toEqual(live?.agent);
    expect(describeCall("run", { command: "web search x" }, CATALOG)?.agent).toBeNull();
  });

  it("reads a skill called as a tool as its command", () => {
    const call = describeCall("github", { command: "repo list" }, CATALOG);
    expect(call?.command).toBe("github repo list");
    expect(call?.workflow?.id).toBe("github repo list");
    expect(describeCall("agent", { command: "<<'EOF'\nfind it\nEOF" }, CATALOG)?.agent?.brief).toBe("find it");
  });

  it("knows an agent command before the catalog loads", () => {
    expect(describeCall("run", { command: "agent plain brief" })?.agent?.brief).toBe("plain brief");
  });

  it("reads older tools as the commands they stand for", () => {
    expect(commandOf("web_search", { query: "k3s ingress", max_results: 3 })).toBe("web search 'k3s ingress' -n 3");
    expect(commandOf("run_workflow", { command: "github.commits openreader", background: true })).toBe(
      "github commits openreader --bg",
    );
    expect(commandOf("check_job", { job_id: "job-1" })).toBe("jobs check job-1");
    expect(commandOf("get_weather", {})).toBeNull();
    expect(describeCall("run_workflow", { workflow: "papers.search" }, CATALOG)?.workflow?.id).toBe("papers search");
  });
});
