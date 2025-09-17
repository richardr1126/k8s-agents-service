"use client";

import { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { BackendServiceMetadata } from '@/lib/types';
import { apiClient } from '@/lib/api-client';

interface ServiceInfoContextType {
  serviceInfo: BackendServiceMetadata | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ServiceInfoContext = createContext<ServiceInfoContextType | null>(null);

export function useServiceInfo() {
  const context = useContext(ServiceInfoContext);
  if (!context) {
    throw new Error('useServiceInfo must be used within ServiceInfoProvider');
  }
  return context;
}

interface ServiceInfoProviderProps {
  children: ReactNode;
}

export function ServiceInfoProvider({ children }: ServiceInfoProviderProps) {
  const [serviceInfo, setServiceInfo] = useState<BackendServiceMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadServiceInfo = async () => {
    try {
      setError(null);
      const info = await apiClient.getServiceInfo();
      setServiceInfo(info);
    } catch (err) {
      console.error('Failed to load service info:', err);
      setError(err instanceof Error ? err.message : 'Failed to load service info');
    } finally {
      setIsLoading(false);
    }
  };

  const refresh = async () => {
    setIsLoading(true);
    await loadServiceInfo();
  };

  useEffect(() => {
    loadServiceInfo();
  }, []);

  const contextValue: ServiceInfoContextType = {
    serviceInfo,
    isLoading,
    error,
    refresh,
  };

  return (
    <ServiceInfoContext.Provider value={contextValue}>
      {children}
    </ServiceInfoContext.Provider>
  );
}