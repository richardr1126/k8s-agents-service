import { ThreadInfo } from './types';

// Database models for user threads
export interface UserThread {
  id: string;
  userId: string;
  title: string;
  timestamp: number;
  agentId?: string;
  modelId?: string;
  lastMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Helper functions for thread management
export function generateThreadId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `thread-${timestamp}-${random}`;
}

export function convertToThreadInfo(dbThread: UserThread): ThreadInfo {
  return {
    id: dbThread.id,
    title: dbThread.title,
    timestamp: dbThread.timestamp,
    agentId: dbThread.agentId,
    modelId: dbThread.modelId,
    lastMessage: dbThread.lastMessage,
  };
}

export function convertFromThreadInfo(threadInfo: ThreadInfo, userId: string): Omit<UserThread, 'createdAt' | 'updatedAt'> {
  return {
    id: threadInfo.id,
    userId,
    title: threadInfo.title,
    timestamp: threadInfo.timestamp,
    agentId: threadInfo.agentId,
    modelId: threadInfo.modelId,
    lastMessage: threadInfo.lastMessage,
  };
}