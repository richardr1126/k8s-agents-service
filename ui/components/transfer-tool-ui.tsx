"use client";

import { ToolCallContentPartComponent } from "@assistant-ui/react";
import { ArrowRightIcon, UserIcon, GlobeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const getAgentIcon = (agentName: string) => {
  switch (agentName) {
    case "web-rag-agent":
      return <GlobeIcon className="h-4 w-4 text-blue-500 dark:text-blue-400" />;
    case "resume-agent":
      return <UserIcon className="h-4 w-4 text-green-500 dark:text-green-400" />;
    default:
      return <ArrowRightIcon className="h-4 w-4 text-purple-500 dark:text-purple-400" />;
  }
};

const getAgentDisplayName = (agentName: string) => {
  switch (agentName) {
    case "web-rag-agent":
      return "Web Research Agent";
    case "resume-agent":
      return "Resume Agent";
    default:
      return agentName.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  }
};

const getAgentDescription = (agentName: string) => {
  switch (agentName) {
    case "web-rag-agent":
      return "Searching the web for current information";
    case "resume-agent":
      return "Searching resume and project information";
    default:
      return `Transferring to ${getAgentDisplayName(agentName)}`;
  }
};



export const TransferToolFallback: ToolCallContentPartComponent = ({
  toolName,
}) => {
  // Extract agent name from tool name (e.g., "call_web-rag-agent" -> "web-rag-agent")
  const agentName = toolName.startsWith("call_") 
    ? toolName.replace("call_", "")
    : toolName;
  
  return (
    <div className={cn(
      "w-full overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm",
      "border-l-4 border-l-purple-500"
    )}>
      <div className="flex items-center gap-3 bg-muted/30 px-4 py-3 border-b border-border/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          {getAgentIcon(agentName)}
        </div>
        
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground truncate">
            Transferred to {getAgentDisplayName(agentName)}
          </h4>
          
          <p className="text-sm text-muted-foreground mt-1">
            {getAgentDescription(agentName)}
          </p>
        </div>

        <div className="flex items-center">
          <ArrowRightIcon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
};