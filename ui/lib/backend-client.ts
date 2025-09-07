import { 
  BackendUserInput, 
  BackendStreamInput, 
  BackendMessage,
  BackendStreamEvent,
  BackendServiceMetadata,
  BackendChatHistory
} from './types';

class BackendClient {
  private baseUrl: string;
  private authToken?: string;

  constructor(baseUrl: string, authToken?: string) {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  async getServiceInfo(): Promise<BackendServiceMetadata> {
    const response = await fetch(`${this.baseUrl}/info`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get service info: ${response.status}`);
    }

    return response.json();
  }

  async getChatHistory(threadId: string): Promise<BackendChatHistory> {
    const response = await fetch(`${this.baseUrl}/history`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ thread_id: threadId }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get chat history: ${response.status}`);
    }

    return response.json();
  }

  async invoke(input: BackendUserInput, agentId?: string): Promise<BackendMessage> {
    const endpoint = agentId ? `/${agentId}/invoke` : '/invoke';
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Failed to invoke agent: ${response.status}`);
    }

    return response.json();
  }

  async *streamChat(
    input: BackendStreamInput, 
    agentId?: string
  ): AsyncGenerator<BackendStreamEvent, void, unknown> {
    const endpoint = agentId ? `/${agentId}/stream` : '/stream';
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Failed to stream chat: ${response.status}`);
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
              const event = JSON.parse(data) as BackendStreamEvent;
              yield event;
            } catch {
              console.error('Failed to parse SSE data:', data);
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

// Server-side only instance
export const createBackendClient = () => {
  const baseUrl = process.env.BACKEND_URL;
  const authToken = process.env.BACKEND_AUTH_TOKEN;

  if (!baseUrl) {
    throw new Error('BACKEND_URL environment variable is not set');
  }

  return new BackendClient(baseUrl, authToken);
};