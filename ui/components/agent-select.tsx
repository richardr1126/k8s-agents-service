"use client";

import { Bot } from "lucide-react";
import { useChat } from "@/components/custom-runtime-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AgentSelect() {
  const { serviceInfo, agentId, setAgentId } = useChat();
  return (
    <Select value={agentId} onValueChange={setAgentId}>
      <SelectTrigger
        aria-label="Agent"
        className="h-6.5 max-w-33 sm:max-w-50 text-xs m-0 px-1 py-0.5 sm:px-2 sm:py-1 w-auto inline-flex items-center gap-1 bg-background/40 dark:bg-background/30 border-muted-foreground/20"
      >
        <Bot className="h-3 w-3 text-muted-foreground" />
        <SelectValue placeholder="Agent" className="truncate text-clip" />
      </SelectTrigger>
      <SelectContent>
        {serviceInfo.agents.map((agent) => (
          <SelectItem key={agent.key} value={agent.key}>
            <span className="truncate">{agent.key}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
