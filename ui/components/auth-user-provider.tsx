"use client";

import { createContext, useContext, ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '@/lib/auth-client';
import { ThreadInfo } from '@/lib/types';

interface UserContextType {
  // User data
  userData: {
    userId: string;
    threads: ThreadInfo[];
    currentThreadId: string | null;
    createdAt: number;
  } | null;
  isLoading: boolean;
  
  // Thread management
  createNewThread: (title?: string, agentId?: string, modelId?: string) => Promise<string | null>;
  switchToThread: (threadId: string) => boolean;
  updateThreadTitle: (threadId: string, newTitle: string) => Promise<boolean>;
  updateThreadActivity: (threadId: string, lastMessage?: string) => Promise<boolean>;
  updateThreadAgent: (threadId: string, agentId: string) => Promise<boolean>;
  updateThreadModel: (threadId: string, modelId: string) => Promise<boolean>;
  deleteThread: (threadId: string) => Promise<boolean>;
  archiveThread: (threadId: string) => Promise<{ success: boolean; newThreadId?: string | null }>;
  clearUserData: () => void;
  
  // Computed values
  activeThreads: ThreadInfo[];
  archivedThreads: ThreadInfo[];
  currentThread: ThreadInfo | null;
}

const UserContext = createContext<UserContextType | null>(null);

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within UserProvider');
  }
  return context;
}

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const { data: session, isPending } = useSession();
  const [userData, setUserData] = useState<UserContextType['userData']>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const isCreatingDefaultThreadRef = useRef(false);

  // API call helper
  const apiCall = useCallback(async (action: string, threadData: Record<string, unknown>) => {
    try {
      const response = await fetch('/api/user/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, threadData }),
      });
      return response.ok ? await response.json() : null;
    } catch (error) {
      console.error('API call error:', error);
      return null;
    }
  }, []);

  // Create a new thread
  const createNewThread = useCallback(async (title: string = 'New Chat', agentId?: string, modelId?: string) => {
    if (!session?.user?.id) return null;

    const result = await apiCall('create', { title, agentId, modelId });
    if (result?.success) {
      return result.threadId;
    }
    return null;
  }, [session?.user?.id, apiCall]);

  // Fetch user threads from the database
  const fetchThreads = useCallback(async () => {
    if (!session?.user?.id) return;

    try {
      const response = await fetch('/api/user/threads');
      if (response.ok) {
        const data = await response.json();
        const threads: ThreadInfo[] = data.threads.map((thread: {
          id: string;
          title: string;
          timestamp: number;
          agentId?: string;
          modelId?: string;
          archived?: boolean;
          lastMessage?: string;
        }) => ({
          id: thread.id,
          title: thread.title,
          timestamp: thread.timestamp,
          agentId: thread.agentId,
          modelId: thread.modelId,
          archived: thread.archived,
          lastMessage: thread.lastMessage,
        }));

        // If no threads exist, create a default one (but only once)
        if (threads.length === 0 && !isCreatingDefaultThreadRef.current) {
          isCreatingDefaultThreadRef.current = true;
          try {
            const newThreadId = await createNewThread('New Chat');
            if (newThreadId) {
              threads.push({
                id: newThreadId,
                title: 'New Chat',
                timestamp: Date.now(),
              });
            }
          } finally {
            isCreatingDefaultThreadRef.current = false;
          }
        }

        setUserData({
          userId: session.user.id,
          threads,
          currentThreadId: currentThreadId || threads[0]?.id || null,
          createdAt: Date.now(),
        });

        // Set current thread if not already set
        if (!currentThreadId && threads.length > 0) {
          setCurrentThreadId(threads[0].id);
        }
      }
    } catch (error) {
      console.error('Error fetching threads:', error);
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id, currentThreadId, createNewThread]);

  // Initialize user data when session changes
  useEffect(() => {
    if (isPending) return;

    if (session?.user) {
      // Reset the flag when session changes to ensure we can create default thread for new users
      isCreatingDefaultThreadRef.current = false;
      fetchThreads();
    } else {
      setUserData(null);
      setCurrentThreadId(null);
      setIsLoading(false);
      isCreatingDefaultThreadRef.current = false;
    }
  }, [session, isPending, fetchThreads]);

  // Switch to a different thread
  const switchToThread = useCallback((threadId: string) => {
    if (!userData) return false;

    const exists = userData.threads.some((t) => t.id === threadId);
    if (exists) {
      setCurrentThreadId(threadId);
      setUserData(prev => prev ? { ...prev, currentThreadId: threadId } : null);
      return true;
    }
    return false;
  }, [userData]);

  // Update thread title
  const updateThreadTitle = useCallback(async (threadId: string, newTitle: string) => {
    const result = await apiCall('update', { id: threadId, title: newTitle });
    if (result?.success) {
      await fetchThreads();
      return true;
    }
    return false;
  }, [apiCall, fetchThreads]);

  // Update thread activity
  const updateThreadActivity = useCallback(async (threadId: string, lastMessage?: string) => {
    const result = await apiCall('update', { id: threadId, lastMessage });
    if (result?.success) {
      await fetchThreads();
      return true;
    }
    return false;
  }, [apiCall, fetchThreads]);

  // Update thread agent
  const updateThreadAgent = useCallback(async (threadId: string, agentId: string) => {
    const result = await apiCall('update', { id: threadId, agentId });
    if (result?.success) {
      await fetchThreads();
      return true;
    }
    return false;
  }, [apiCall, fetchThreads]);

  // Update thread model
  const updateThreadModel = useCallback(async (threadId: string, modelId: string) => {
    const result = await apiCall('update', { id: threadId, modelId });
    if (result?.success) {
      await fetchThreads();
      return true;
    }
    return false;
  }, [apiCall, fetchThreads]);

  // Delete a thread
  const deleteThread = useCallback(async (threadId: string) => {
    const result = await apiCall('delete', { threadId });
    if (result?.success) {
      // If deleting current thread, switch to another one
      if (currentThreadId === threadId && userData) {
        const remainingThreads = userData.threads.filter(t => t.id !== threadId);
        setCurrentThreadId(remainingThreads[0]?.id || null);
      }
      await fetchThreads();
      return true;
    }
    return false;
  }, [apiCall, fetchThreads, currentThreadId, userData]);

  // Archive a thread
  const archiveThread = useCallback(async (threadId: string) => {
    const result = await apiCall('update', { id: threadId, archived: true });
    if (result?.success) {
      let newThreadId: string | null = null;

      // If archiving current thread, create a new one
      if (currentThreadId === threadId) {
        newThreadId = await createNewThread('New Chat');
        if (newThreadId) {
          setCurrentThreadId(newThreadId);
        }
      }

      await fetchThreads();
      return { success: true, newThreadId };
    }
    return { success: false };
  }, [apiCall, fetchThreads, currentThreadId, createNewThread]);

  // Clear user data (for logout)
  const clearUserData = useCallback(() => {
    setUserData(null);
    setCurrentThreadId(null);
  }, []);

  // Computed values
  const activeThreads = userData?.threads?.filter(t => !t.archived) || [];
  const archivedThreads = userData?.threads?.filter(t => t.archived) || [];
  const currentThread = userData?.threads?.find(t => t.id === currentThreadId) || null;

  // Update userData with current thread ID
  const userDataWithCurrentThread = userData ? {
    ...userData,
    currentThreadId,
  } : null;

  const contextValue: UserContextType = {
    userData: userDataWithCurrentThread,
    isLoading: isLoading || isPending,
    createNewThread,
    switchToThread,
    updateThreadTitle,
    updateThreadActivity,
    updateThreadAgent,
    updateThreadModel,
    deleteThread,
    archiveThread,
    clearUserData,
    activeThreads,
    archivedThreads,
    currentThread,
  };

  return (
    <UserContext.Provider value={contextValue}>
      {children}
    </UserContext.Provider>
  );
}