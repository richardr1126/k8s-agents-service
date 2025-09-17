"use client";

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
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
  className 
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
      <div className={`flex items-center gap-2 ${className}`}>
        <Brain className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading models...</span>
      </div>
    );
  }

  if (!serviceInfo?.models?.length) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Brain className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">No models available</span>
      </div>
    );
  }

  const currentModel = selectedModelId || serviceInfo.default_model;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Brain className="h-4 w-4 text-muted-foreground" />
      <Select
        value={currentModel || ""}
        onValueChange={onModelChange}
      >
        <SelectTrigger className="w-full sm:w-[180px] h-8 sm:h-10 text-xs sm:text-sm py-1 sm:py-2">
          <SelectValue placeholder="Select a model">
            {currentModel || "Select a model"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {serviceInfo.models.map((model) => (
            <SelectItem key={model} value={model}>
              <div className="flex flex-col max-w-[250px]">
                <span className="font-medium truncate">{model}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}