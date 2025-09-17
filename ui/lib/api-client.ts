import { ChatRequest, ChatMessage, BackendServiceMetadata } from './types';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  async getServiceInfo(): Promise<BackendServiceMetadata> {
    const response = await fetch(`${this.baseUrl}/api/service-info`);
    
    if (!response.ok) {
      throw new Error(`Failed to get service info: ${response.status}`);
    }
    
    return response.json();
  }

  async getChatHistory(threadId: string): Promise<{ messages: ChatMessage[] }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      });

      if (!response.ok) {
        // If the thread doesn't exist or has no history, return empty messages
        if (response.status === 404 || response.status === 500) {
          console.log(`No chat history found for thread ${threadId}, returning empty history`);
          return { messages: [] };
        }
        throw new Error(`Failed to get chat history: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      console.log(`Error getting chat history for thread ${threadId}:`, error);
      // Return empty messages as fallback
      return { messages: [] };
    }
  }

  async sendMessage(request: ChatRequest): Promise<ChatMessage> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.status}`);
    }

    return response.json();
  }

  async *streamMessage(request: ChatRequest): AsyncGenerator<unknown, void, unknown> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to stream message: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No readable stream available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            
            if (data === '[DONE]') {
              return;
            }

            try {
              const event = JSON.parse(data);
              yield event;
            } catch {
              console.error('Failed to parse stream data:', data);
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export const apiClient = new ApiClient();