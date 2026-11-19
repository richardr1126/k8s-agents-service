"use client";

import { Brain } from "lucide-react";
import { useChat } from "@/components/custom-runtime-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ModelSelect() {
  const { serviceInfo, modelId, setModelId } = useChat();
  return (
    <Select value={modelId} onValueChange={setModelId}>
      <SelectTrigger
        aria-label="Model"
        className="h-6.5 max-w-30 sm:max-w-50 text-xs px-1 py-0.5 sm:px-2 sm:py-1 w-auto inline-flex items-center gap-1 bg-background/40 dark:bg-background/30 border-muted-foreground/20"
      >
        <Brain className="h-3 w-3 text-muted-foreground" />
        <SelectValue placeholder="Model" className="truncate text-clip" />
      </SelectTrigger>
      <SelectContent className="text-sm">
        {serviceInfo.models.map((model) => (
          <SelectItem key={model} value={model}>
            {/* The provider prefix is noise on a phone; the model name is what fits. */}
            <span className="truncate">
              {model.includes("/") && <span className="hidden sm:inline">{model.slice(0, model.indexOf("/") + 1)}</span>}
              {model.slice(model.indexOf("/") + 1)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
