"use client";

import { Bot } from "lucide-react";
import { useMemo } from "react";
import { useChat } from "@/components/custom-runtime-provider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { modesOf } from "@/lib/modes";

/** Picks the chat's mode: the assistant on its own (Auto), one of its focuses, or another agent. */
export function AgentSelect() {
  const { serviceInfo, agentId, setAgentId } = useChat();
  const modes = useMemo(() => modesOf(serviceInfo), [serviceInfo]);
  const assistantModes = modes.filter((m) => m.agentId === "assistant");
  const others = modes.filter((m) => m.agentId !== "assistant");
  const item = (m: (typeof modes)[number]) => (
    <SelectItem key={m.key} value={m.key}>
      <span className="truncate">{m.label}</span>
    </SelectItem>
  );
  return (
    <Select value={agentId} onValueChange={setAgentId}>
      <SelectTrigger
        aria-label="Mode"
        className="text-muted-foreground hover:text-foreground hover:bg-accent data-[state=open]:bg-accent data-[state=open]:text-foreground h-7 min-w-0 max-w-36 sm:max-w-52 w-auto gap-1.5 rounded-md border-0 bg-transparent px-2 text-xs font-medium shadow-none dark:bg-transparent dark:hover:bg-accent focus-visible:ring-[3px] [&>svg:last-child]:opacity-60"
      >
        <Bot className="size-3.5 shrink-0" />
        <SelectValue placeholder="Mode" className="truncate text-clip" />
      </SelectTrigger>
      <SelectContent>
        {assistantModes.map(item)}
        {others.length > 0 && assistantModes.length > 0 && <SelectSeparator />}
        {others.length > 0 && (
          <SelectGroup>
            {assistantModes.length > 0 && <SelectLabel>Other agents</SelectLabel>}
            {others.map(item)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
