'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { useRateLimit } from '@/components/rate-limit-provider';

interface RateLimitDisplayProps {
  compact?: boolean;
}

export function RateLimitDisplay({ compact = false }: RateLimitDisplayProps) {
  const { status, error, isAtLimit } = useRateLimit();

  if (error || !status) {
    return null; // Don't show error in compact mode, just wait for data
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className={isAtLimit ? 'text-destructive' : 'text-muted-foreground'}>
          {status.remainingMessages}/{status.limit}
        </span>
      </div>
    );
  }

  // If not compact, return null since we only use compact mode
  return null;
}

export function RateLimitBanner() {
  const { status, isAtLimit, timeUntilReset } = useRateLimit();

  if (!status || !isAtLimit) {
    return null;
  }

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 dark:bg-red-950 dark:border-red-800">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-red-500 dark:text-red-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-red-700 dark:text-red-300">
            <span className="font-medium">Daily limit reached:</span> {status.limit} messages used. Resets in {timeUntilReset}.
            {status.userType === 'anonymous' && ' Create an account for 15 messages per day!'}
          </p>
        </div>
      </div>
    </div>
  );
}