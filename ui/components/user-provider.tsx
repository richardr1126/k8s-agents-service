"use client";

import { createContext, useContext, ReactNode } from 'react';
import { useUserStorage } from '@/hooks/use-user-storage';
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
  createNewThread: (title?: string, agentId?: string, modelId?: string) => string | null;
  switchToThread: (threadId: string) => boolean;
  updateThreadTitle: (threadId: string, newTitle: string) => boolean;
  updateThreadActivity: (threadId: string, lastMessage?: string) => boolean;
  updateThreadAgent: (threadId: string, agentId: string) => boolean;
  updateThreadModel: (threadId: string, modelId: string) => boolean;
  deleteThread: (threadId: string) => boolean;
  archiveThread: (threadId: string) => { success: boolean; newThreadId?: string | null };
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
  const userStorage = useUserStorage();
  
  // Computed values
  const activeThreads = userStorage.userData?.threads?.filter(t => !t.archived) || [];
  const archivedThreads = userStorage.userData?.threads?.filter(t => t.archived) || [];
  const currentThread = userStorage.userData?.threads?.find(t => t.id === userStorage.userData?.currentThreadId) || null;
  
  const contextValue: UserContextType = {
    ...userStorage,
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