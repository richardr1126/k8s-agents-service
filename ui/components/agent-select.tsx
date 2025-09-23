"use client";

import { useEffect, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServiceInfo } from "@/components/service-info-provider";

interface AgentSelectProps {
  selectedAgentId?: string | null;
  onAgentChange?: (agentId: string) => void;
  className?: string;
}

export function AgentSelect({ 
  selectedAgentId, 
  onAgentChange, 
  className,
}: AgentSelectProps) {
  const { serviceInfo, isLoading: loading } = useServiceInfo();
  const [hasSetDefault, setHasSetDefault] = useState(false);

  // Set default agent when service info loads and no agent is selected
  useEffect(() => {
    if (serviceInfo && !selectedAgentId && !hasSetDefault && serviceInfo.default_agent && onAgentChange) {
      onAgentChange(serviceInfo.default_agent);
      setHasSetDefault(true);
    }
  }, [serviceInfo, selectedAgentId, hasSetDefault, onAgentChange]);

  if (loading) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
        <span className="text-xs text-muted-foreground">Loading agents...</span>
      </div>
    );
  }

  if (!serviceInfo?.agents?.length) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">No agents</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <Select
        value={selectedAgentId || serviceInfo.default_agent || ""}
        onValueChange={onAgentChange}
      >
        <SelectTrigger className="h-6.5 max-w-33 sm:max-w-50 text-xs m-0 px-1 py-0.5 sm:px-2 sm:py-1 w-auto inline-flex items-center gap-1 bg-background/40 dark:bg-background/30 border-muted-foreground/20">
          <Bot className="h-3 w-3 text-muted-foreground" />
          <SelectValue placeholder="Agent" className="truncate text-clip" />
        </SelectTrigger>
        <SelectContent>
          {serviceInfo.agents.map((agent) => (
            <SelectItem key={agent.key} value={agent.key}>
              <div className="flex flex-col max-w-[250px]">
                <span className="truncate">{agent.key}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}