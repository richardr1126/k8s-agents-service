import { NextRequest, NextResponse } from 'next/server';
import { createBackendClient } from '@/lib/backend-client';
import { ChatMessage, ToolCall } from '@/lib/types';
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

    const backendClient = createBackendClient();
    const history = await backendClient.getChatHistory(threadId);

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