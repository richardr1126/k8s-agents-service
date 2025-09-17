import { NextRequest, NextResponse } from 'next/server';
import { ChatMessage, ToolCall, BackendChatHistory } from '@/lib/types';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { threadId } = body;

    const baseUrl = process.env.BACKEND_URL;
    const authToken = process.env.BACKEND_AUTH_TOKEN;

    if (!baseUrl) {
      throw new Error('BACKEND_URL environment variable is not set');
    }

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      requestHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${baseUrl}/history`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ thread_id: threadId }),
    });

    if (!response.ok) {
      throw new Error(`Backend request failed: ${response.status}`);
    }

    const history: BackendChatHistory = await response.json();

    // Convert backend messages to frontend format
    const messages: ChatMessage[] = history.messages.map((msg, index) => {
      const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map(tc => ({
        id: tc.id || `tool-${index}-${Math.random()}`,
        name: tc.name,
        args: tc.args,
      }));

      return {
        id: `msg-${index}-${Date.now()}`,
        role: msg.type === 'human' ? 'user' : 'assistant',
        content: msg.content,
        timestamp: Date.now(),
        runId: msg.run_id,
        toolCalls,
      };
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error('History API error:', error);
    return NextResponse.json(
      { error: 'Failed to get chat history' },
      { status: 500 }
    );
  }
}