import type { Catalog } from "./commands";

const wf = (id: string, activity: string, card?: "subagent") => ({
  id,
  description: "",
  background: "optional" as const,
  ui: { activity, ...(card && { card }) },
});

/** A slice of the backend's catalog, for tests. */
export const CATALOG: Catalog = [
  { name: "agent", description: "", ui: { icon: "bot", label: "Sub-agent" }, workflows: [wf("agent", "Working with a sub-agent", "subagent")] },
  {
    name: "github",
    description: "",
    ui: { icon: "github", label: "GitHub" },
    workflows: [wf("github repo list", "Listing repositories"), wf("github repo view", "Reading a README"), wf("github commits", "Reading commits")],
  },
  { name: "papers", description: "", ui: { icon: "file-text", label: "Papers" }, workflows: [wf("papers search", "Searching arXiv")] },
  { name: "web", description: "", ui: { icon: "globe", label: "Web" }, workflows: [wf("web search", "Searching the web"), wf("web read", "Reading a page")] },
  { name: "jobs", description: "", ui: { icon: "clock", label: "Jobs" }, workflows: [wf("jobs check", "Checking a job")] },
];
