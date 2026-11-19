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
        className="text-muted-foreground hover:text-foreground hover:bg-accent data-[state=open]:bg-accent data-[state=open]:text-foreground h-7 max-w-36 sm:max-w-52 w-auto gap-1.5 rounded-md border-0 bg-transparent px-2 text-xs font-medium shadow-none dark:bg-transparent dark:hover:bg-accent focus-visible:ring-[3px] [&>svg:last-child]:opacity-60"
      >
        <Bot className="size-3.5" />
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
