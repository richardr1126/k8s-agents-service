import type { ServiceInfo } from "@/lib/types";

/**
 * A chat's mode is the agent it runs, plus the assistant's focus when one is
 * picked: "assistant", "assistant:github", or a standalone agent's key. It is
 * what threads store as `agentId`, so a conversation reopens in its mode.
 */
export type Mode = { key: string; agentId: string; focus: string | null; label: string; description: string };

const FOCUS_NAME = /^[a-z0-9-]{1,40}$/;

export function splitMode(key: string): { agentId: string; focus: string | null } {
  const [agentId, focus] = key.split(":", 2);
  return { agentId, focus: focus && FOCUS_NAME.test(focus) ? focus : null };
}

/** The assistant and its focuses first, then the other agents the service lists. */
export function modesOf(info: ServiceInfo): Mode[] {
  const assistant = info.agents.find((a) => a.key === "assistant");
  const modes: Mode[] = [];
  if (assistant) {
    modes.push({ key: "assistant", agentId: "assistant", focus: null, label: "Auto", description: assistant.description });
    for (const f of info.focuses ?? []) {
      modes.push({ key: `assistant:${f.name}`, agentId: "assistant", focus: f.name, label: f.label, description: f.description });
    }
  }
  for (const a of info.agents) {
    if (a.key !== "assistant") modes.push({ key: a.key, agentId: a.key, focus: null, label: a.key, description: a.description });
  }
  return modes;
}
