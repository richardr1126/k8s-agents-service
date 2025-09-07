"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BackendServiceMetadata } from "@/lib/types";
import { apiClient } from "@/lib/frontend-api-client";

interface AgentSelectProps {
  selectedAgentId?: string | null;
  onAgentChange?: (agentId: string) => void;
  className?: string;
}

export function AgentSelect({ 
  selectedAgentId, 
  onAgentChange, 
  className 
}: AgentSelectProps) {
  const [serviceInfo, setServiceInfo] = useState<BackendServiceMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadServiceInfo = async () => {
      try {
        const info = await apiClient.getServiceInfo();
        setServiceInfo(info);
        
        // If no agent is selected but we have a default, use it
        if (!selectedAgentId && info.default_agent && onAgentChange) {
          onAgentChange(info.default_agent);
        }
      } catch (error) {
        console.error("Failed to load service info:", error);
      } finally {
        setLoading(false);
      }
    };

    loadServiceInfo();
  }, [selectedAgentId, onAgentChange]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading agents...</span>
      </div>
    );
  }

  if (!serviceInfo?.agents?.length) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">No agents available</span>
      </div>
    );
  }

  const currentAgent = serviceInfo.agents.find(
    agent => agent.key === (selectedAgentId || serviceInfo.default_agent)
  );

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Bot className="h-4 w-4 text-muted-foreground" />
      <Select
        value={selectedAgentId || serviceInfo.default_agent || ""}
        onValueChange={onAgentChange}
      >
        <SelectTrigger className="w-full sm:w-[180px] h-8 sm:h-10 text-xs sm:text-sm py-1 sm:py-2">
          <SelectValue placeholder="Select an agent">
            {currentAgent?.key || "Select an agent"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {serviceInfo.agents.map((agent) => (
            <SelectItem key={agent.key} value={agent.key}>
              <div className="flex flex-col max-w-[250px]">
                <span className="font-medium truncate">{agent.key}</span>
                {agent.description && (
                  <span className="text-xs text-muted-foreground truncate">
                    {agent.description.length > 60 
                      ? `${agent.description.substring(0, 60)}...` 
                      : agent.description
                    }
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}