/** Labels for what a run is doing, read from the newest assistant message. */

import { describeCall, type Call, type Catalog } from "@/lib/commands";

const AGENT_NAMES: Record<string, string> = { web: "web research", resume: "resume", richard: "about-Richard" };

export type Part = {
  type: string;
  text?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  messages?: readonly { content: readonly Part[] }[];
};

function toolLabel(name: string): string {
  const n = name.toLowerCase();
  if (n === "web_vector_search") return "Searching the web";
  if (n === "resume_search") return "Searching the resume";
  if (n === "projects_search") return "Searching projects";
  if (n.includes("search")) return "Searching";
  return `Running ${name.replace(/[_-]/g, " ")}`;
}

/** What a command is doing: its activity in the catalog, else its skill and command words. */
function commandLabel(call: Call): string {
  if (call.workflow?.ui.activity) return call.workflow.ui.activity;
  const words = call.words.filter((w) => !w.startsWith("-")).slice(0, 2).join(" ");
  return words ? `Running ${words}` : "Running a command";
}

/** What the run is doing now, from its newest unfinished tool call (sub-agents included), or null. */
export function activityOf(content: readonly Part[], catalog?: Catalog): string | null {
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (part.type !== "tool-call" || part.result !== undefined || !part.toolName) continue;
    const call = describeCall(part.toolName, part.args, catalog);
    if (call?.agent) {
      const nested = part.messages?.at(-1)?.content;
      const inner = nested ? activityOf(nested, catalog) : null;
      if (inner) return inner;
      const { type, brief } = call.agent;
      // The type arrives with the streamed arguments, a moment after the call itself.
      if (!type) return brief ? "Asking a sub-agent" : "Starting a sub-agent";
      return type === "general" ? "Asking a sub-agent" : `Asking the ${AGENT_NAMES[type] ?? type} agent`;
    }
    return call ? commandLabel(call) : toolLabel(part.toolName);
  }
  return null;
}
