"use client";

import { useEffect, useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServiceInfo } from "@/components/service-info-provider";

interface ModelSelectProps {
  selectedModelId?: string | null;
  onModelChange?: (modelId: string) => void;
  className?: string;
}

export function ModelSelect({ 
  selectedModelId, 
  onModelChange, 
  className,
}: ModelSelectProps) {
  const { serviceInfo, isLoading: loading } = useServiceInfo();
  const [hasSetDefault, setHasSetDefault] = useState(false);

  // Set default model when service info loads and no model is selected
  useEffect(() => {
    if (serviceInfo && !selectedModelId && !hasSetDefault && serviceInfo.default_model && onModelChange) {
      onModelChange(serviceInfo.default_model);
      setHasSetDefault(true);
    }
  }, [serviceInfo, selectedModelId, hasSetDefault, onModelChange]);

  if (loading) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
        <span className="text-xs text-muted-foreground">Loading models...</span>
      </div>
    );
  }

  if (!serviceInfo?.models?.length) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Brain className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">No models</span>
      </div>
    );
  }

  const currentModel = selectedModelId || serviceInfo.default_model;

  return (
    <div className={className}>
      <Select value={currentModel || ""} onValueChange={onModelChange}>
        <SelectTrigger className="h-6.5 text-xs px-1 py-0.5 sm:px-2 sm:py-1 w-auto inline-flex items-center gap-1 bg-background/40 dark:bg-background/30 border-muted-foreground/20">
          <Brain className="h-3 w-3 text-muted-foreground" />
          <SelectValue placeholder="Model" className="truncate" />
        </SelectTrigger>
        <SelectContent className="text-sm">
          {serviceInfo.models.map((model) => (
            <SelectItem key={model} value={model}>
              <div className="flex flex-col max-w-[250px]">
                <span className="truncate">{model}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}