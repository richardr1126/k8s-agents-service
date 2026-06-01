'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { isUnlimitedRateLimit } from '@/lib/usage-overrides';

export interface RateLimitStatus {
  allowed: boolean;
  currentCount: number;
  limit: number;
  remainingMessages: number;
  resetTime: Date;
  userType: 'anonymous' | 'authenticated';
}

export interface RateLimitContextType {
  status: RateLimitStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isAtLimit: boolean;
  timeUntilReset: string;
  incrementCount: () => void;
  onMessageStart: () => void;
  onMessageComplete: () => void;
}

const RateLimitContext = createContext<RateLimitContextType | null>(null);

export function useRateLimit(): RateLimitContextType {
  const context = useContext(RateLimitContext);
  if (!context) {
    throw new Error('useRateLimit must be used within a RateLimitProvider');
  }
  return context;
}

interface RateLimitProviderProps {
  children: React.ReactNode;
}

function calculateTimeUntilReset(resetTime: Date): string {
  const now = new Date();
  const timeDiff = resetTime.getTime() - now.getTime();
  
  if (timeDiff <= 0) {
    return 'Soon';
  }
  
  const hours = Math.floor(timeDiff / (1000 * 60 * 60));
  const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

export function RateLimitProvider({ children }: RateLimitProviderProps) {
  const [status, setStatus] = useState<RateLimitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Track pending message operations to delay count updates
  const pendingMessageRef = useRef<number>(0);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/rate-limit/status');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch rate limit status: ${response.status}`);
      }
      
      const data = await response.json();
      
      setStatus({
        ...data,
        resetTime: new Date(data.resetTime)
      });
    } catch (err) {
      console.error('Error fetching rate limit status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Calculate time until reset
  const timeUntilReset = status ? calculateTimeUntilReset(status.resetTime) : '';
  const isAtLimit = status ? (!isUnlimitedRateLimit(status.limit) && status.remainingMessages <= 0) : false;

  // Increment count locally (for immediate UI feedback)
  const incrementCount = useCallback(() => {
    setStatus(prevStatus => {
      if (!prevStatus) return prevStatus;
      if (isUnlimitedRateLimit(prevStatus.limit)) return prevStatus;
      
      const newCurrentCount = prevStatus.currentCount + 1;
      const newRemainingMessages = Math.max(0, prevStatus.limit - newCurrentCount);
      
      return {
        ...prevStatus,
        currentCount: newCurrentCount,
        remainingMessages: newRemainingMessages
      };
    });
  }, []);

  // Called when a message starts being sent
  const onMessageStart = useCallback(() => {
    pendingMessageRef.current += 1;
    
    // Clear any existing timeout
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }
  }, []);

  // Called when a message completes (success or error)
  const onMessageComplete = useCallback(() => {
    pendingMessageRef.current = Math.max(0, pendingMessageRef.current - 1);
    
    // Clear any existing timeout
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }
    
    // If no more pending messages, schedule an update
    if (pendingMessageRef.current === 0) {
      updateTimeoutRef.current = setTimeout(() => {
        fetchStatus();
        updateTimeoutRef.current = null;
      }, 1000); // Wait 1 second after message completion to refresh
    }
  }, [fetchStatus]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  const contextValue: RateLimitContextType = {
    status,
    loading,
    error,
    refresh: fetchStatus,
    isAtLimit,
    timeUntilReset,
    incrementCount,
    onMessageStart,
    onMessageComplete
  };

  return (
    <RateLimitContext.Provider value={contextValue}>
      {children}
    </RateLimitContext.Provider>
  );
}
