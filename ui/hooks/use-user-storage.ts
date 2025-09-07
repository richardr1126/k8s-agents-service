"use client";

import { useState, useEffect, useCallback } from 'react';
import { ThreadInfo } from '@/lib/types';

interface UserData {
  userId: string;
  threads: ThreadInfo[];
  currentThreadId: string | null;
  createdAt: number;
}

const USER_STORAGE_KEY = 'k8s-agents-user-data';
const USER_ID_PREFIX = 'user';

// Generate a unique user ID
function generateUserId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${USER_ID_PREFIX}-${timestamp}-${random}`;
}

// Generate a unique thread ID
function generateThreadId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `thread-${timestamp}-${random}`;
}

export function useUserStorage() {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize user data from localStorage or create new user
  useEffect(() => {
    try {
      const storedData = localStorage.getItem(USER_STORAGE_KEY);
      
      if (storedData) {
        const parsed: UserData = JSON.parse(storedData);
        setUserData(parsed);
      } else {
        // Create new user with default thread
        const defaultThreadId = generateThreadId();
        const newUserData: UserData = {
          userId: generateUserId(),
          threads: [{
            id: defaultThreadId,
            title: 'New Chat',
            timestamp: Date.now(),
          }],
          currentThreadId: defaultThreadId,
          createdAt: Date.now(),
        };
        
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUserData));
        setUserData(newUserData);
      }
    } catch (error) {
      console.error('Error loading user data from localStorage:', error);
      // Fallback: create new user data
      const defaultThreadId = generateThreadId();
      const fallbackUserData: UserData = {
        userId: generateUserId(),
        threads: [{
          id: defaultThreadId,
          title: 'New Chat',
          timestamp: Date.now(),
        }],
        currentThreadId: defaultThreadId,
        createdAt: Date.now(),
      };
      setUserData(fallbackUserData);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Apply an update function atomically against the latest state and persist it.
  const applyUpdate = useCallback((updater: (prev: UserData) => UserData) => {
    setUserData((prev) => {
      const base = prev ?? {
        userId: generateUserId(),
        threads: [],
        currentThreadId: null,
        createdAt: Date.now(),
      };
      const updated = updater(base);
      try {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error('Error saving user data to localStorage:', error);
      }
      return updated;
    });
  }, []);

  // Create a new thread
  const createNewThread = useCallback((title: string = 'New Chat', agentId?: string, modelId?: string) => {
    if (!userData) return null;

    const newThreadId = generateThreadId();
    const newThread: ThreadInfo = {
      id: newThreadId,
      title,
      timestamp: Date.now(),
      agentId,
      modelId,
    };

    applyUpdate((prev) => ({
      ...prev,
      threads: [newThread, ...prev.threads], // Add to beginning
      currentThreadId: newThreadId,
    }));

    return newThreadId;
  }, [userData, applyUpdate]);

  // Switch to a different thread
  const switchToThread = useCallback((threadId: string) => {
    if (!userData) return false;

    let exists = false;
    applyUpdate((prev) => {
      exists = prev.threads.some((t) => t.id === threadId);
      if (!exists) return prev;
      return { ...prev, currentThreadId: threadId };
    });

    return exists;
  }, [userData, applyUpdate]);

  // Update thread title
  const updateThreadTitle = useCallback((threadId: string, newTitle: string) => {
    if (!userData) return false;

    applyUpdate((prev) => ({
      ...prev,
      threads: prev.threads.map((thread) =>
        thread.id === threadId ? { ...thread, title: newTitle } : thread
      ),
    }));

    return true;
  }, [userData, applyUpdate]);

  // Update thread's last message and timestamp
  const updateThreadActivity = useCallback((threadId: string, lastMessage?: string) => {
    if (!userData) return false;

    applyUpdate((prev) => {
      const updatedThreads = prev.threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              lastMessage,
              timestamp: Date.now(),
            }
          : thread
      );

      // Sort threads by timestamp (most recent first)
      updatedThreads.sort((a, b) => b.timestamp - a.timestamp);

      return {
        ...prev,
        threads: updatedThreads,
      };
    });

    return true;
  }, [userData, applyUpdate]);

  // Update thread's selected agent
  const updateThreadAgent = useCallback((threadId: string, agentId: string) => {
    if (!userData) return false;

    applyUpdate((prev) => ({
      ...prev,
      threads: prev.threads.map((thread) =>
        thread.id === threadId ? { ...thread, agentId } : thread
      ),
    }));

    return true;
  }, [userData, applyUpdate]);

  // Update thread's selected model
  const updateThreadModel = useCallback((threadId: string, modelId: string) => {
    if (!userData) return false;

    applyUpdate((prev) => ({
      ...prev,
      threads: prev.threads.map((thread) =>
        thread.id === threadId ? { ...thread, modelId } : thread
      ),
    }));

    return true;
  }, [userData, applyUpdate]);

  // Delete a thread
  const deleteThread = useCallback((threadId: string) => {
    if (!userData) return false;

    applyUpdate((prev) => {
      const updatedThreads = prev.threads.filter((t) => t.id !== threadId);

      // If we're deleting the current thread, switch to the most recent one
      let newCurrentThreadId = prev.currentThreadId;
      if (prev.currentThreadId === threadId) {
        newCurrentThreadId = updatedThreads.length > 0 ? updatedThreads[0].id : null;

        // If no threads left, create a new default one
        if (!newCurrentThreadId) {
          const defaultThreadId = generateThreadId();
          updatedThreads.push({
            id: defaultThreadId,
            title: 'New Chat',
            timestamp: Date.now(),
          });
          newCurrentThreadId = defaultThreadId;
        }
      }

      return {
        ...prev,
        threads: updatedThreads,
        currentThreadId: newCurrentThreadId,
      };
    });

    return true;
  }, [userData, applyUpdate]);

  // Archive a thread (mark it as archived instead of deleting)
  const archiveThread = useCallback((threadId: string) => {
    if (!userData) return { success: false };

    let newThreadId: string | null = null;

    applyUpdate((prev) => {
      const updatedThreads = prev.threads.map((thread) =>
        thread.id === threadId ? { ...thread, archived: true } : thread
      );

      // If we're archiving the current thread, switch to the most recent active one
      let newCurrentThreadId = prev.currentThreadId;
      if (prev.currentThreadId === threadId) {
        const activeThreads = updatedThreads.filter((t) => !t.archived);
        newCurrentThreadId = activeThreads.length > 0 ? activeThreads[0].id : null;

        // If no active threads left, create a new default one
        if (!newCurrentThreadId) {
          const defaultThreadId = generateThreadId();
          updatedThreads.push({
            id: defaultThreadId,
            title: 'New Chat',
            timestamp: Date.now(),
          });
          newCurrentThreadId = defaultThreadId;
          newThreadId = defaultThreadId; // Store the new thread ID to return
        }
      }

      return {
        ...prev,
        threads: updatedThreads,
        currentThreadId: newCurrentThreadId,
      };
    });

    return { success: true, newThreadId };
  }, [userData, applyUpdate]);

  // Clear all user data (useful for reset/logout)
  const clearUserData = useCallback(() => {
    try {
      localStorage.removeItem(USER_STORAGE_KEY);
      setUserData(null);
      setIsLoading(true);
      // This will trigger the useEffect to create new user data
    } catch (error) {
      console.error('Error clearing user data:', error);
    }
  }, []);

  return {
    userData,
    isLoading,
    createNewThread,
    switchToThread,
    updateThreadTitle,
    updateThreadActivity,
    updateThreadAgent,
    updateThreadModel,
    deleteThread,
    archiveThread,
    clearUserData,
  };
}