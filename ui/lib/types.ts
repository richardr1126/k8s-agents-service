import type { AgUiMessage } from "@assistant-ui/react-ag-ui";

export type ServiceInfo = {
  agents: { key: string; description: string; deprecated?: boolean }[];
  models: string[];
  default_agent: string;
  default_model: string;
  focuses?: { name: string; label: string; description: string }[];
  skills?: { name: string; description: string; workflows: string[] }[];
};

export type ThreadRow = { id: string; title: string; agentId: string; modelId: string | null; updatedAt: string };

/** One sub-agent run in a thread, as returned by the backend's POST /history. */
export type SubagentRun = {
  subagentRunId: string;
  parentToolCallId: string;
  name: string;
  description: string;
  status: "success" | "error";
  error?: string;
};

export type History = {
  messages: (AgUiMessage & { subagentRunId?: string })[];
  subagents: SubagentRun[];
};
