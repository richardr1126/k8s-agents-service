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
        className="text-muted-foreground hover:text-foreground hover:bg-accent data-[state=open]:bg-accent data-[state=open]:text-foreground h-7 max-w-36 sm:max-w-52 w-auto gap-1.5 rounded-md border-0 bg-transparent px-2 text-xs font-medium shadow-none dark:bg-transparent dark:hover:bg-accent focus-visible:ring-[3px] [&>svg:last-child]:opacity-60"
      >
        <Brain className="size-3.5" />
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
