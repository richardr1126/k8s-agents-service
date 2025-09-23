// Re-export the hook from the provider for backward compatibility
export { useRateLimit, type RateLimitStatus, type RateLimitContextType } from '@/components/rate-limit-provider';

// Legacy interface for backward compatibility
export interface UseRateLimitResult {
  status: import('@/components/rate-limit-provider').RateLimitStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isAtLimit: boolean;
  timeUntilReset: string;
}