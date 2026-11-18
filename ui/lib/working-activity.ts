/** Labels for what a run is doing, read from the newest assistant message. */

const AGENT_NAMES: Record<string, string> = { web: "web research", resume: "resume" };

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
  if (n === "web_search" || n === "web_vector_search") return "Searching the web";
  if (n === "resume_search") return "Searching the resume";
  if (n === "projects_search") return "Searching projects";
  if (n.includes("search")) return "Searching";
  return `Running ${name.replace(/[_-]/g, " ")}`;
}

/** What the run is doing now, from its newest unfinished tool call (sub-agents included), or null. */
export function activityOf(content: readonly Part[]): string | null {
  for (let i = content.length - 1; i >= 0; i--) {
    const part = content[i];
    if (part.type !== "tool-call" || part.result !== undefined || !part.toolName) continue;
    if (part.toolName === "task") {
      const nested = part.messages?.at(-1)?.content;
      const inner = nested ? activityOf(nested) : null;
      if (inner) return inner;
      const type = typeof part.args?.subagent_type === "string" ? part.args.subagent_type : "";
      // The type arrives with the streamed arguments, a moment after the call itself.
      if (!type) return "Starting a sub-agent";
      return `Asking the ${AGENT_NAMES[type] ?? type} agent`;
    }
    return toolLabel(part.toolName);
  }
  return null;
}
