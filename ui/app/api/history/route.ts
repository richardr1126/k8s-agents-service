import { NextRequest, NextResponse } from 'next/server';
import { ChatMessage, ToolCall, BackendChatHistory } from '@/lib/types';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { Pool } from 'pg';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

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

    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID is required' }, { status: 400 });
    }

    // Validate user ownership of the thread in frontend database
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT id FROM user_threads WHERE id = $1 AND user_id = $2',
        [threadId, session.user.id]
      );

      if (result.rowCount === 0) {
        return NextResponse.json({ 
          error: 'Thread not found or you do not have permission to access it' 
        }, { status: 403 });
      }
    } finally {
      client.release();
    }

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
      body: JSON.stringify({ thread_id: threadId }), // Backend doesn't track users, only needs thread_id
    });

    if (!response.ok) {
      throw new Error(`Backend request failed: ${response.status}`);
    }

    const history: BackendChatHistory = await response.json();

    // Create a map of tool results by tool_call_id for efficient lookup
    const toolResults = new Map<string, string>();
    history.messages.forEach(msg => {
      if (msg.type === 'tool' && msg.tool_call_id) {
        toolResults.set(msg.tool_call_id, msg.content);
      }
    });

    // Convert backend messages to frontend format, filtering out standalone tool messages
    // since they'll be embedded in their corresponding AI messages
    const messages: ChatMessage[] = history.messages
      .filter(msg => msg.type !== 'tool') // Filter out standalone tool result messages
      .map((msg, index) => {
        let toolCalls: ToolCall[] | undefined;
        
        // If this AI message has tool calls, associate the results
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          toolCalls = msg.tool_calls.map(tc => ({
            id: tc.id || `tool-${index}-${Math.random()}`,
            name: tc.name,
            args: tc.args,
            result: tc.id ? toolResults.get(tc.id) : undefined, // Associate the tool result
          }));
        }

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