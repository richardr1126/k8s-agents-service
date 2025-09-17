"use client";

import { useUrlState } from "@/hooks/use-url-state";
import { useThreadContext } from "@/components/custom-runtime-provider";
import { useUser } from "@/components/auth-user-provider";

export function DebugInfo() {
  const { activeThreads, archivedThreads } = useUser();
  const { threadId } = useUrlState();
  const { currentThreadId, userId } = useThreadContext();

  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-black/80 text-white text-xs p-2 rounded max-w-xs overflow-auto z-50">
      <div className="font-bold mb-1">Debug Info:</div>
      <div>User ID: {userId}</div>
      <div>URL Thread: {threadId || 'none'}</div>
      <div>Current Thread: {currentThreadId || 'none'}</div>
      <div>Active Threads: {activeThreads.length}</div>
      <div>Archived Threads: {archivedThreads.length}</div>
      <div className="mt-1">
        <div className="font-semibold">Active Threads:</div>
        {activeThreads.map(thread => (
          <div key={thread.id} className="ml-2 truncate text-green-400">
            {thread.title} 
            {currentThreadId === thread.id && ' [current]'}
          </div>
        ))}
        {archivedThreads.length > 0 && (
          <>
            <div className="font-semibold mt-1">Archived:</div>
            {archivedThreads.map(thread => (
              <div key={thread.id} className="ml-2 truncate text-gray-400">
                {thread.title}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}