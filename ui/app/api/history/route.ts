import { NextRequest, NextResponse } from 'next/server';
import { ChatMessage, ToolCall, BackendChatHistory, ROOT_BRANCH_ID, isTaskData } from '@/lib/types';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { Pool } from 'pg';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

type BranchMetadata = {
  branchId?: string;
  branchLabel?: string;
};

const extractBranchMetadata = (responseMetadata: unknown): BranchMetadata => {
  if (!responseMetadata || typeof responseMetadata !== "object") {
    return {};
  }

  const metadata = responseMetadata as Record<string, unknown>;
  const explicitBranchId = typeof metadata.branch_id === "string" ? metadata.branch_id : undefined;
  const pathBranchId = Array.isArray(metadata.langgraph_path)
    ? metadata.langgraph_path.filter((item): item is string => typeof item === "string").join("/")
    : undefined;

  const branchId = explicitBranchId || pathBranchId || undefined;
  if (!branchId) return {};

  const explicitLabel = typeof metadata.branch_label === "string" ? metadata.branch_label : undefined;
  const inferredLabel = branchId === ROOT_BRANCH_ID
    ? "main"
    : (branchId.split("/").pop()?.split(":")[0] || branchId);

  return {
    branchId,
    branchLabel: explicitLabel || inferredLabel,
  };
};

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
        const branchMeta = extractBranchMetadata(msg.response_metadata);

        if (msg.type === 'custom' && isTaskData(msg.custom_data)) {
          const taskData = msg.custom_data;
          const taskToolCallId = `task-${taskData.run_id}`;
          return {
            id: `msg-task-${index}-${Date.now()}`,
            role: 'assistant' as const,
            content: '',
            reasoningContent: undefined,
            partOrder: [`tool:${taskToolCallId}`],
            timestamp: Date.now(),
            runId: msg.run_id,
            branchId: branchMeta.branchId,
            branchLabel: branchMeta.branchLabel,
            toolCalls: [
              {
                id: taskToolCallId,
                name: 'task_update',
                args: { taskData },
              },
            ],
          };
        }

        let toolCalls: ToolCall[] | undefined;
        
        // If this AI message has tool calls, associate the results
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const batchId = msg.tool_calls.length > 1
            ? `tool-batch-history-${threadId}-${index}`
            : undefined;
          toolCalls = msg.tool_calls.map(tc => ({
            id: tc.id || `tool-${index}-${Math.random()}`,
            name: tc.name,
            args: tc.args,
            result: tc.id ? toolResults.get(tc.id) : undefined, // Associate the tool result
            groupId: batchId,
          }));
        }

        return {
          id: `msg-${index}-${Date.now()}`,
          role: msg.type === 'human' ? 'user' : 'assistant',
          content: msg.content,
          reasoningContent: msg.reasoning_content,
          partOrder: msg.type === 'ai'
            ? [
                ...(msg.reasoning_content?.length ? ['reasoning'] : []),
                ...(toolCalls?.map(tc => `tool:${tc.id}`) ?? []),
                ...(msg.content ? ['text'] : []),
              ]
            : undefined,
          timestamp: Date.now(),
          runId: msg.run_id,
          branchId: branchMeta.branchId,
          branchLabel: branchMeta.branchLabel,
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
