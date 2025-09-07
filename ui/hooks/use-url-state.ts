"use client";

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect } from 'react';

export function useUrlState() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const threadId = searchParams.get('thread');

  const setThreadId = useCallback((newThreadId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (newThreadId) {
      params.set('thread', newThreadId);
    } else {
      params.delete('thread');
    }

    const newUrl = `${pathname}?${params.toString()}`;
    router.replace(newUrl);
  }, [searchParams, router, pathname]);

  return {
    threadId,
    setThreadId,
  };
}