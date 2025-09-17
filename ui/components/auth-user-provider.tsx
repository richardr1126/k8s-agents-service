"use client";

import { createContext, useContext, ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '@/lib/auth-client';
import { ThreadInfo } from '@/lib/types';

// Constants
const SAFETY_NET_DELAY = 100; // ms
const SYNC_INTERVAL = 30000; // 30 seconds
const DEFAULT_THREAD_TITLE = 'New Chat';

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
  const createNewThread = useCallback((title: string = DEFAULT_THREAD_TITLE, agentId?: string, modelId?: string) => {
    if (!session?.user?.id) return null;

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
      if (!prev) {
        // For new accounts, create initial user data structure
        return {
          userId: session.user.id,
          threads: [newThread],
          currentThreadId: tempId,
          createdAt: Date.now(),
        };
      }
      return {
        ...prev,
        threads: [newThread, ...prev.threads],
        currentThreadId: tempId,
      };
    });
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
          setUserData(prev => {
            if (!prev) return null;
            return {
              ...prev,
              currentThreadId: prev.currentThreadId === tempId ? result.threadId : prev.currentThreadId,
            };
          });
          
          pendingOperationsRef.current.delete(tempId);
          
          // Reset safety net flag if this was created by safety net
          if (isCreatingDefaultThreadRef.current) {
            isCreatingDefaultThreadRef.current = false;
          }
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
          setUserData(prev => {
            if (!prev || prev.currentThreadId !== tempId) return prev;
            const remainingThreads = prev.threads.filter(t => t.id !== tempId);
            return {
              ...prev,
              currentThreadId: remainingThreads.length > 0 ? remainingThreads[0].id : null,
            };
          });
          
          pendingOperationsRef.current.delete(tempId);
          console.error('Failed to create thread in database');
          
          // Reset safety net flag if this was created by safety net
          if (isCreatingDefaultThreadRef.current) {
            isCreatingDefaultThreadRef.current = false;
          }
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
        
        // Reset safety net flag if this was created by safety net
        if (isCreatingDefaultThreadRef.current) {
          isCreatingDefaultThreadRef.current = false;
        }
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

        // If no threads exist, set up empty user data structure
        if (dbThreads.length === 0) {
          setUserData(prev => {
            if (!prev) {
              return {
                userId: session.user.id,
                threads: [],
                currentThreadId: null,
                createdAt: Date.now(),
              };
            }
            return prev;
          });
          return;
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
      setIsLoading(false);
      isCreatingDefaultThreadRef.current = false;
    }
  }, [session, isPending, fetchThreads]);

  // Safety net: Ensure authenticated users always have at least one thread
  useEffect(() => {
    const shouldCreateDefaultThread = (
      !isLoading && 
      session?.user?.id && 
      userData && 
      userData.threads.length === 0 && 
      !isCreatingDefaultThreadRef.current
    );

    if (shouldCreateDefaultThread) {
      isCreatingDefaultThreadRef.current = true;
      
      const timeoutId = setTimeout(() => {
        const newThreadId = createNewThread(DEFAULT_THREAD_TITLE);
        if (!newThreadId) {
          console.warn('Safety net: Failed to create default thread');
          isCreatingDefaultThreadRef.current = false;
        }
      }, SAFETY_NET_DELAY);
      
      return () => {
        clearTimeout(timeoutId);
        isCreatingDefaultThreadRef.current = false;
      };
    }
  }, [isLoading, session?.user?.id, userData, createNewThread]);

  // Switch to a different thread
  const switchToThread = useCallback((threadId: string) => {
    if (!userData) return false;

    const threadExists = userData.threads.some(t => t.id === threadId);
    if (threadExists) {
      setUserData(prev => prev ? { ...prev, currentThreadId: threadId } : null);
      return true;
    }
    return false;
  }, [userData]);

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
    // Store original data for rollback
    const originalThread = userDataRef.current?.threads.find(t => t.id === threadId);
    const newTimestamp = Date.now();
    
    // Optimistically update local state
    setUserData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        threads: prev.threads.map(t => 
          t.id === threadId ? { ...t, lastMessage, timestamp: newTimestamp } : t
        ),
      };
    });

    pendingOperationsRef.current.set(threadId, 'update');

    try {
      const result = await apiCall('update', { id: threadId, lastMessage, timestamp: newTimestamp });
      if (result?.success) {
        pendingOperationsRef.current.delete(threadId);
        return true;
      } else {
        // Rollback on failure
        if (originalThread) {
          setUserData(prev => {
            if (!prev) return null;
            return {
              ...prev,
              threads: prev.threads.map(t => 
                t.id === threadId ? originalThread : t
              ),
            };
          });
        }
        pendingOperationsRef.current.delete(threadId);
        return false;
      }
    } catch (error) {
      console.error('Error updating thread activity:', error);
      // Rollback on error
      if (originalThread) {
        setUserData(prev => {
          if (!prev) return null;
          return {
            ...prev,
            threads: prev.threads.map(t => 
              t.id === threadId ? originalThread : t
            ),
          };
        });
      }
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

    // Optimistically remove from local state and handle thread switching
    setUserData(prev => {
      if (!prev) return null;
      
      const remainingThreads = prev.threads.filter(t => t.id !== threadId);
      let newCurrentThreadId = prev.currentThreadId;
      
      // If deleting current thread, switch to most recent remaining thread
      if (prev.currentThreadId === threadId) {
        if (remainingThreads.length > 0) {
          const mostRecent = remainingThreads.sort((a, b) => b.timestamp - a.timestamp)[0];
          newCurrentThreadId = mostRecent.id;
        } else {
          // Last thread deleted - safety net will create a new one
          newCurrentThreadId = null;
        }
      }
      
      return {
        ...prev,
        threads: remainingThreads,
        currentThreadId: newCurrentThreadId,
      };
    });

    pendingOperationsRef.current.set(threadId, 'delete');

    try {
      const result = await apiCall('delete', { threadId });
      if (result?.success) {
        pendingOperationsRef.current.delete(threadId);
        // Safety net will handle creating a new thread if this was the last one
        return true;
      } else {
        // Rollback on failure
        setUserData(prev => {
          if (!prev) return null;
          return {
            ...prev,
            threads: [...prev.threads, originalThread].sort((a, b) => b.timestamp - a.timestamp),
            currentThreadId: originalThread.id, // Restore to deleted thread
          };
        });
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
          currentThreadId: originalThread.id, // Restore to deleted thread
        };
      });
      pendingOperationsRef.current.delete(threadId);
      return false;
    }
  }, [apiCall]);



  // Clear user data (for logout)
  const clearUserData = useCallback(() => {
    setUserData(null);
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
    }, SYNC_INTERVAL);
    
    return () => clearInterval(interval);
  }, [session?.user?.id, userData, fetchThreads]);

  // Computed values
  const activeThreads = userData?.threads || [];
  const currentThread = userData?.threads?.find(t => t.id === userData?.currentThreadId) || null;

  const contextValue: UserContextType = {
    userData,
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