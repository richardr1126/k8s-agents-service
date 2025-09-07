import { ChatMessage } from '@/lib/types';

/**
 * Generate a thread title based on the first user message
 */
export function generateThreadTitle(firstMessage?: string): string {
  if (!firstMessage) return 'New Chat';
  
  // Clean the message and truncate it
  const cleaned = firstMessage.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
  
  if (cleaned.length <= 40) {
    return cleaned;
  }
  
  // Try to cut at word boundary
  const truncated = cleaned.substring(0, 40);
  const lastSpaceIndex = truncated.lastIndexOf(' ');
  
  if (lastSpaceIndex > 20) {
    return truncated.substring(0, lastSpaceIndex) + '...';
  }
  
  return truncated + '...';
}

/**
 * Extract the first meaningful message from a thread for title generation
 */
export function getThreadTitleFromMessages(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user' && m.content.trim());
  return generateThreadTitle(firstUserMessage?.content);
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  // Less than a minute
  if (diff < 60 * 1000) {
    return 'Just now';
  }
  
  // Less than an hour
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}m ago`;
  }
  
  // Less than a day
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}h ago`;
  }
  
  // Less than a week
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}d ago`;
  }
  
  // Format as date
  return new Date(timestamp).toLocaleDateString();
}