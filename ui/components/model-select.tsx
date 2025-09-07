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
import { BackendServiceMetadata } from "@/lib/types";
import { apiClient } from "@/lib/frontend-api-client";

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
  const [serviceInfo, setServiceInfo] = useState<BackendServiceMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadServiceInfo = async () => {
      try {
        const info = await apiClient.getServiceInfo();
        setServiceInfo(info);
        
        // If no model is selected but we have a default, use it
        if (!selectedModelId && info.default_model && onModelChange) {
          onModelChange(info.default_model);
        }
      } catch (error) {
        console.error("Failed to load service info:", error);
      } finally {
        setLoading(false);
      }
    };

    loadServiceInfo();
  }, [selectedModelId, onModelChange]);

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