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
  createNewThread: (title?: string, agentId?: string, modelId?: string) => string | null; // Now returns immediately
  switchToThread: (threadId: string) => boolean;
  updateThreadTitle: (threadId: string, newTitle: string) => Promise<boolean>;
  updateThreadActivity: (threadId: string, lastMessage?: string) => Promise<boolean>;
  updateThreadAgent: (threadId: string, agentId: string) => Promise<boolean>;
  updateThreadModel: (threadId: string, modelId: string) => Promise<boolean>;
  deleteThread: (threadId: string) => Promise<boolean>;
  clearUserData: () => void;
  
  // Computed values
  activeThreads: ThreadInfo[];
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
  
  // Track pending operations for optimistic updates
  const pendingOperationsRef = useRef<Map<string, 'create' | 'update' | 'delete'>>(new Map());
  const syncQueueRef = useRef<Array<() => Promise<void>>>([]);
  const isSyncingRef = useRef(false);
  
  // Keep ref to current userData for stable access in callbacks
  const userDataRef = useRef(userData);
  useEffect(() => {
    userDataRef.current = userData;
  }, [userData]);

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

  // Process sync queue
  const processSyncQueue = useCallback(async () => {
    if (isSyncingRef.current || syncQueueRef.current.length === 0) return;
    
    isSyncingRef.current = true;
    
    while (syncQueueRef.current.length > 0) {
      const operation = syncQueueRef.current.shift();
      if (operation) {
        try {
          await operation();
        } catch (error) {
          console.error('Sync operation failed:', error);
        }
      }
    }
    
    isSyncingRef.current = false;
  }, []);

  // Add operation to sync queue
  const queueSync = useCallback((operation: () => Promise<void>) => {
    syncQueueRef.current.push(operation);
    processSyncQueue();
  }, [processSyncQueue]);

  // Generate optimistic thread ID
  const generateOptimisticId = () => `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Create a new thread with optimistic updates
  const createNewThread = useCallback((title: string = 'New Chat', agentId?: string, modelId?: string) => {
    if (!session?.user?.id) return null;

    // Prevent multiple simultaneous creations
    if (isCreatingDefaultThreadRef.current) {
      return null;
    }

    const tempId = generateOptimisticId();
    const newThread: ThreadInfo = {
      id: tempId,
      title,
      timestamp: Date.now(),
      agentId,
      modelId,
    };

    // Optimistically add to local state
    setUserData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        threads: [newThread, ...prev.threads],
      };
    });

    setCurrentThreadId(tempId);
    pendingOperationsRef.current.set(tempId, 'create');

    // Queue database sync
    queueSync(async () => {
      try {
        const result = await apiCall('create', { title, agentId, modelId });
        if (result?.success) {
          // Replace temp ID with real ID
          setUserData(prev => {
            if (!prev) return null;
            return {
              ...prev,
              threads: prev.threads.map(t => 
                t.id === tempId 
                  ? { ...t, id: result.threadId }
                  : t
              ),
            };
          });
          
          // Update current thread ID if it was the temp one
          setCurrentThreadId(current => current === tempId ? result.threadId : current);
          
          pendingOperationsRef.current.delete(tempId);
        } else {
          // Remove failed thread from local state
          setUserData(prev => {
            if (!prev) return null;
            return {
              ...prev,
              threads: prev.threads.filter(t => t.id !== tempId),
            };
          });
          
          // Switch to another thread if this was current
          setCurrentThreadId(current => {
            if (current === tempId) {
              // Get current threads from state at the time of error
              const currentUserData = userDataRef.current;
              if (currentUserData) {
                const remainingThreads = currentUserData.threads.filter(t => t.id !== tempId);
                return remainingThreads.length > 0 ? remainingThreads[0].id : null;
              }
            }
            return current;
          });
          
          pendingOperationsRef.current.delete(tempId);
          console.error('Failed to create thread in database');
        }
      } catch (error) {
        console.error('Error creating thread:', error);
        // Handle error same as failed result
        setUserData(prev => {
          if (!prev) return null;
          return {
            ...prev,
            threads: prev.threads.filter(t => t.id !== tempId),
          };
        });
        pendingOperationsRef.current.delete(tempId);
      }
    });

    return tempId;
  }, [session?.user?.id, apiCall, queueSync]);

  // Stable createNewThread reference for use in fetchThreads
  const createNewThreadRef = useRef<(title?: string, agentId?: string, modelId?: string) => string | null>(null);
  createNewThreadRef.current = createNewThread;
  
  // Fetch user threads from the database (used for initial load and periodic sync)
  const fetchThreads = useCallback(async (forceRefresh = false) => {
    if (!session?.user?.id) return;

    try {
      const response = await fetch('/api/user/threads');
      if (response.ok) {
        const data = await response.json();
        const dbThreads: ThreadInfo[] = data.threads.map((thread: {
          id: string;
          title: string;
          timestamp: number;
          agentId?: string;
          modelId?: string;
          lastMessage?: string;
        }) => ({
          id: thread.id,
          title: thread.title,
          timestamp: thread.timestamp,
          agentId: thread.agentId,
          modelId: thread.modelId,
          lastMessage: thread.lastMessage,
        }));

        // If no threads exist, create a default one (but only once)
        if (dbThreads.length === 0 && !isCreatingDefaultThreadRef.current) {
          isCreatingDefaultThreadRef.current = true;
          try {
            const newThreadId = createNewThreadRef.current?.('New Chat');
            if (newThreadId) {
              // Set up initial user data with the new thread
              setUserData({
                userId: session.user.id,
                threads: [],  // Will be populated by createNewThread optimistic update
                currentThreadId: newThreadId,
                createdAt: Date.now(),
              });
              setCurrentThreadId(newThreadId);
              return;
            }
          } finally {
            isCreatingDefaultThreadRef.current = false;
          }
        }

        // Merge database state with local optimistic updates
        setUserData(prev => {
          if (!prev && dbThreads.length === 0) return null;
          
          if (!prev) {
            // Initial load
            const mostRecentThread = dbThreads.length > 0 
              ? dbThreads.sort((a, b) => b.timestamp - a.timestamp)[0]
              : null;
            const defaultThreadId = mostRecentThread?.id || null;
            
            setCurrentThreadId(defaultThreadId);
            
            return {
              userId: session.user.id,
              threads: dbThreads,
              currentThreadId: defaultThreadId,
              createdAt: Date.now(),
            };
          }
          
          if (forceRefresh) {
            // Force refresh - replace all data
            return {
              ...prev,
              threads: dbThreads,
            };
          }
          
          // Merge: keep optimistic updates, sync confirmed changes
          const mergedThreads = dbThreads.map(dbThread => {
            const isPending = pendingOperationsRef.current.has(dbThread.id);
            const localThread = prev.threads.find(t => t.id === dbThread.id);
            
            // If pending, keep local changes
            if (isPending && localThread) {
              return localThread;
            }
            
            // Otherwise use database version
            return dbThread;
          });
          
          // Add any local-only threads (optimistic creates)
          const localOnlyThreads = prev.threads.filter(localThread => 
            !dbThreads.find(dbThread => dbThread.id === localThread.id) &&
            pendingOperationsRef.current.has(localThread.id)
          );
          
          return {
            ...prev,
            threads: [...localOnlyThreads, ...mergedThreads].sort((a, b) => b.timestamp - a.timestamp),
          };
        });
      }
    } catch (error) {
      console.error('Error fetching threads:', error);
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]); // Remove createNewThread dependency

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
    const currentUserData = userDataRef.current;
    if (!currentUserData) return false;

    const exists = currentUserData.threads.some((t) => t.id === threadId);
    if (exists) {
      setCurrentThreadId(threadId);
      setUserData(prev => prev ? { ...prev, currentThreadId: threadId } : null);
      return true;
    }
    return false;
  }, []);

  // Update thread title with optimistic updates
  const updateThreadTitle = useCallback(async (threadId: string, newTitle: string) => {
    // Store original title for rollback
    const originalTitle = userDataRef.current?.threads.find(t => t.id === threadId)?.title;
    
    // Optimistically update local state
    setUserData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        threads: prev.threads.map(t => 
          t.id === threadId ? { ...t, title: newTitle } : t
        ),
      };
    });

    pendingOperationsRef.current.set(threadId, 'update');

    try {
      const result = await apiCall('update', { id: threadId, title: newTitle });
      if (result?.success) {
        pendingOperationsRef.current.delete(threadId);
        return true;
      } else {
        // Rollback on failure
        if (originalTitle) {
          setUserData(prev => {
            if (!prev) return null;
            return {
              ...prev,
              threads: prev.threads.map(t => 
                t.id === threadId ? { ...t, title: originalTitle } : t
              ),
            };
          });
        }
        pendingOperationsRef.current.delete(threadId);
        return false;
      }
    } catch (error) {
      console.error('Error updating thread title:', error);
      // Rollback on error
      if (originalTitle) {
        setUserData(prev => {
          if (!prev) return null;
          return {
            ...prev,
            threads: prev.threads.map(t => 
              t.id === threadId ? { ...t, title: originalTitle } : t
            ),
          };
        });
      }
      pendingOperationsRef.current.delete(threadId);
      return false;
    }
  }, [apiCall]);

  // Update thread activity with optimistic updates
  const updateThreadActivity = useCallback(async (threadId: string, lastMessage?: string) => {
    // Store original lastMessage for rollback
    const originalMessage = userDataRef.current?.threads.find(t => t.id === threadId)?.lastMessage;
    
    // Optimistically update local state
    setUserData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        threads: prev.threads.map(t => 
          t.id === threadId ? { ...t, lastMessage, timestamp: Date.now() } : t
        ),
      };
    });

    pendingOperationsRef.current.set(threadId, 'update');

    try {
      const result = await apiCall('update', { id: threadId, lastMessage });
      if (result?.success) {
        pendingOperationsRef.current.delete(threadId);
        return true;
      } else {
        // Rollback on failure
        setUserData(prev => {
          if (!prev) return null;
          return {
            ...prev,
            threads: prev.threads.map(t => 
              t.id === threadId ? { ...t, lastMessage: originalMessage } : t
            ),
          };
        });
        pendingOperationsRef.current.delete(threadId);
        return false;
      }
    } catch (error) {
      console.error('Error updating thread activity:', error);
      // Rollback on error
      setUserData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          threads: prev.threads.map(t => 
            t.id === threadId ? { ...t, lastMessage: originalMessage } : t
          ),
        };
      });
      pendingOperationsRef.current.delete(threadId);
      return false;
    }
  }, [apiCall]);

  // Update thread agent with optimistic updates
  const updateThreadAgent = useCallback(async (threadId: string, agentId: string) => {
    // Store original agentId for rollback
    const originalAgentId = userDataRef.current?.threads.find(t => t.id === threadId)?.agentId;
    
    // Optimistically update local state
    setUserData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        threads: prev.threads.map(t => 
          t.id === threadId ? { ...t, agentId } : t
        ),
      };
    });

    pendingOperationsRef.current.set(threadId, 'update');

    try {
      const result = await apiCall('update', { id: threadId, agentId });
      if (result?.success) {
        pendingOperationsRef.current.delete(threadId);
        return true;
      } else {
        // Rollback on failure
        setUserData(prev => {
          if (!prev) return null;
          return {
            ...prev,
            threads: prev.threads.map(t => 
              t.id === threadId ? { ...t, agentId: originalAgentId } : t
            ),
          };
        });
        pendingOperationsRef.current.delete(threadId);
        return false;
      }
    } catch (error) {
      console.error('Error updating thread agent:', error);
      // Rollback on error
      setUserData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          threads: prev.threads.map(t => 
            t.id === threadId ? { ...t, agentId: originalAgentId } : t
          ),
        };
      });
      pendingOperationsRef.current.delete(threadId);
      return false;
    }
  }, [apiCall]);

  // Update thread model with optimistic updates
  const updateThreadModel = useCallback(async (threadId: string, modelId: string) => {
    // Store original modelId for rollback
    const originalModelId = userDataRef.current?.threads.find(t => t.id === threadId)?.modelId;
    
    // Optimistically update local state
    setUserData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        threads: prev.threads.map(t => 
          t.id === threadId ? { ...t, modelId } : t
        ),
      };
    });

    pendingOperationsRef.current.set(threadId, 'update');

    try {
      const result = await apiCall('update', { id: threadId, modelId });
      if (result?.success) {
        pendingOperationsRef.current.delete(threadId);
        return true;
      } else {
        // Rollback on failure
        setUserData(prev => {
          if (!prev) return null;
          return {
            ...prev,
            threads: prev.threads.map(t => 
              t.id === threadId ? { ...t, modelId: originalModelId } : t
            ),
          };
        });
        pendingOperationsRef.current.delete(threadId);
        return false;
      }
    } catch (error) {
      console.error('Error updating thread model:', error);
      // Rollback on error
      setUserData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          threads: prev.threads.map(t => 
            t.id === threadId ? { ...t, modelId: originalModelId } : t
          ),
        };
      });
      pendingOperationsRef.current.delete(threadId);
      return false;
    }
  }, [apiCall]);

  // Delete a thread with optimistic updates
  const deleteThread = useCallback(async (threadId: string) => {
    // Store original thread for rollback
    const originalThread = userDataRef.current?.threads.find(t => t.id === threadId);
    if (!originalThread) return false;

    // Handle switching away from deleted thread
    let newCurrentThreadId = currentThreadId;
    let needsNewThread = false;
    
    if (currentThreadId === threadId && userDataRef.current) {
      const remainingThreads = userDataRef.current.threads.filter(t => t.id !== threadId);
      if (remainingThreads.length > 0) {
        const mostRecent = remainingThreads.sort((a, b) => b.timestamp - a.timestamp)[0];
        newCurrentThreadId = mostRecent.id;
      } else {
        // This is the last thread - we'll need to create a new one
        needsNewThread = true;
        newCurrentThreadId = null;
      }
      setCurrentThreadId(newCurrentThreadId);
    }

    // Optimistically remove from local state
    setUserData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        threads: prev.threads.filter(t => t.id !== threadId),
      };
    });

    pendingOperationsRef.current.set(threadId, 'delete');

    try {
      const result = await apiCall('delete', { threadId });
      if (result?.success) {
        pendingOperationsRef.current.delete(threadId);
        
        // If this was the last thread, create a new one
        if (needsNewThread) {
          setTimeout(() => {
            const newThreadId = createNewThread('New Chat');
            if (newThreadId) {
              setCurrentThreadId(newThreadId);
            }
          }, 100); // Small delay to ensure state is updated
        }
        
        return true;
      } else {
        // Rollback on failure
        setUserData(prev => {
          if (!prev) return null;
          return {
            ...prev,
            threads: [...prev.threads, originalThread].sort((a, b) => b.timestamp - a.timestamp),
          };
        });
        setCurrentThreadId(currentThreadId); // Restore original
        pendingOperationsRef.current.delete(threadId);
        return false;
      }
    } catch (error) {
      console.error('Error deleting thread:', error);
      // Rollback on error
      setUserData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          threads: [...prev.threads, originalThread].sort((a, b) => b.timestamp - a.timestamp),
        };
      });
      setCurrentThreadId(currentThreadId); // Restore original
      pendingOperationsRef.current.delete(threadId);
      return false;
    }
  }, [apiCall, currentThreadId, createNewThread]);



  // Clear user data (for logout)
  const clearUserData = useCallback(() => {
    setUserData(null);
    setCurrentThreadId(null);
    pendingOperationsRef.current.clear();
    syncQueueRef.current = [];
    isSyncingRef.current = false;
    isCreatingDefaultThreadRef.current = false;
  }, []);

  // Periodic sync with database (every 30 seconds)
  useEffect(() => {
    if (!session?.user?.id || !userData) return;
    
    const interval = setInterval(() => {
      // Only sync if no pending operations
      if (pendingOperationsRef.current.size === 0) {
        fetchThreads();
      }
    }, 30000); // 30 seconds
    
    return () => clearInterval(interval);
  }, [session?.user?.id, userData, fetchThreads]); // Add fetchThreads dependency

  // Computed values
  const activeThreads = userData?.threads || [];
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
    clearUserData,
    activeThreads,
    currentThread,
  };

  return (
    <UserContext.Provider value={contextValue}>
      {children}
    </UserContext.Provider>
  );
}