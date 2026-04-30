import { NextRequest, NextResponse } from 'next/server';
import {
  ChatRequest,
  ChatMessage,
  BackendMessage,
  BackendStreamEvent,
  normalizeBranchId,
  TaskBranchMapContent,
  isTaskData,
} from '@/lib/types';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { Pool } from 'pg';
import { rateLimiter } from '@/lib/rate-limiter';
import { getIsAnonymous } from '@/lib/utils';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});
const DEBUG_TASK_BRANCH_MAP = process.env.DEBUG_TASK_BRANCH_MAP === "1";

export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: ChatRequest = await req.json();
    const { message, threadId, agentId, model, stream } = body;

    // Use authenticated user ID instead of client-provided userId
    const userId = session.user.id;

    // Check rate limiting before processing the message
    const userInfo = {
      id: userId,
      isAnonymous: getIsAnonymous(session.user)
    };

    const rateLimitResult = await rateLimiter.checkAndIncrementLimit(userInfo);

    if (!rateLimitResult.allowed) {
      return NextResponse.json({ 
        error: 'Rate limit exceeded',
        details: {
          limit: rateLimitResult.limit,
          currentCount: rateLimitResult.currentCount,
          resetTime: rateLimitResult.resetTime,
          remainingMessages: rateLimitResult.remainingMessages
        }
      }, { status: 429 });
    }

    // If threadId is provided, validate user ownership
    if (threadId) {
      const client = await pool.connect();
      try {
        const result = await client.query(
          'SELECT id FROM user_threads WHERE id = $1 AND user_id = $2',
          [threadId, userId]
        );

        if (result.rowCount === 0) {
          return NextResponse.json({ 
            error: 'Thread not found or you do not have permission to access it' 
          }, { status: 403 });
        }
      } finally {
        client.release();
      }
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

    if (stream) {
      // Handle streaming response
      const streamInput = {
        message,
        thread_id: threadId,
        user_id: userId,
        model,
        stream_tokens: true,
      };

      const endpoint = agentId ? `/${agentId}/stream` : '/stream';
      const backendResponse = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(streamInput),
      });

      if (!backendResponse.ok) {
        throw new Error(`Backend request failed: ${backendResponse.status}`);
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let messageCounter = 0;
            const branchMessageIds = new Map<string, string>();
            const toolCallBranchIds = new Map<string, string>();

            const emit = (payload: Record<string, unknown>): void => {
              const chunk = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
              controller.enqueue(chunk);
            };

            const toBranchKey = (branchId?: string): string => normalizeBranchId(branchId);
            const toBranchSlug = (branchId?: string): string =>
              toBranchKey(branchId).replace(/[^a-zA-Z0-9_-]/g, "_");
            const toScopedMessageId = (branchId: string, rawId?: string): string =>
              rawId
                ? `m-${toBranchSlug(branchId)}-${rawId}`
                : `msg-${toBranchSlug(branchId)}-${Date.now()}-${++messageCounter}`;

            const ensureBranchMessage = (
              branchId?: string,
              preferredMessageId?: string,
            ): string => {
              const key = toBranchKey(branchId);
              const scopedPreferredId = toScopedMessageId(key, preferredMessageId);
              let nextMessageId = branchMessageIds.get(key);
              if (!nextMessageId || (preferredMessageId && nextMessageId !== scopedPreferredId)) {
                nextMessageId = scopedPreferredId;
                branchMessageIds.set(key, nextMessageId);
              }
              return nextMessageId;
            };

            const closeBranchMessage = (branchId?: string): void => {
              const key = toBranchKey(branchId);
              branchMessageIds.delete(key);
            };
            const rememberToolCallBranch = (toolCallId?: string, branchId?: string): void => {
              if (!toolCallId) return;
              toolCallBranchIds.set(toolCallId, toBranchKey(branchId));
            };
            const closeToolCallMessage = (toolCallId?: string): void => {
              if (!toolCallId) return;
              const branchId = toolCallBranchIds.get(toolCallId);
              if (!branchId) return;
              closeBranchMessage(branchId);
            };

            const reader = backendResponse.body?.getReader();
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
                  if (!line.startsWith('data: ')) {
                    continue;
                  }
                  const data = line.slice(6).trim();

                  if (data === '[DONE]') {
                    const doneChunk = encoder.encode('data: [DONE]\n\n');
                    controller.enqueue(doneChunk);
                    controller.close();
                    return;
                  }

                  try {
                    const event = JSON.parse(data) as BackendStreamEvent;
                    const branchId = toBranchKey(event.branch_id);
                    const runId = typeof event.run_id === "string" ? event.run_id : undefined;
                    const messageIdFromEventRaw = event.message_id || event.messageId;
                    const messageIdFromEvent = messageIdFromEventRaw
                      ? toScopedMessageId(branchId, messageIdFromEventRaw)
                      : undefined;

                    if (event.type === 'message' && typeof event.content === 'object') {
                      const backendMessage = event.content as BackendMessage;

                      if (backendMessage.type === 'custom' && backendMessage.custom_data) {
                        if (isTaskData(backendMessage.custom_data)) {
                          const taskData = backendMessage.custom_data;
                          const taskMessageId = ensureBranchMessage(branchId, `task-${taskData.run_id}`);
                          emit({
                            type: 'tool_call',
                            content: {
                              id: `task-${taskData.run_id}`,
                              name: 'task_update',
                              args: { taskData },
                            },
                            messageId: taskMessageId,
                            branchId,
                            runId,
                          });
                          continue;
                        }
                        emit({
                          type: 'message',
                          content: backendMessage,
                          messageId: messageIdFromEvent,
                          branchId,
                          branchLabel: event.branch_label,
                          runId,
                        });
                        continue;
                      }

                      if (backendMessage.type === 'tool' && backendMessage.tool_call_id) {
                        const toolResultMessageId = ensureBranchMessage(branchId, messageIdFromEventRaw);
                        emit({
                          type: 'tool_result',
                          content: {
                            toolCallId: backendMessage.tool_call_id,
                            result: backendMessage.content
                          },
                          messageId: toolResultMessageId,
                          branchId,
                          runId,
                        });
                        closeToolCallMessage(backendMessage.tool_call_id);
                        closeBranchMessage(branchId);
                        continue;
                      }

                      if (backendMessage.type === 'ai' || backendMessage.type === 'human') {
                        const role = backendMessage.type === 'human' ? 'user' : 'assistant';
                        const messageId = role === 'assistant'
                          ? (messageIdFromEvent || ensureBranchMessage(branchId, messageIdFromEventRaw))
                          : (messageIdFromEvent || toScopedMessageId(branchId));
                        const hasTextContent = (backendMessage.content || '').trim().length > 0;
                        const hasReasoning = Boolean(backendMessage.reasoning_content && backendMessage.reasoning_content.length > 0);
                        const hasToolCalls = Boolean(backendMessage.tool_calls && backendMessage.tool_calls.length > 0);
                        if (role === 'assistant' && !hasTextContent && !hasReasoning && hasToolCalls) {
                          // Tool calls are streamed as dedicated `tool_call` events; skip this empty wrapper AI message.
                          closeBranchMessage(branchId);
                          continue;
                        }

                        const chatMessage: ChatMessage = {
                          id: messageId,
                          role,
                          content: backendMessage.content || '',
                          reasoningContent: backendMessage.reasoning_content,
                          partOrder: backendMessage.content ? ['text'] : undefined,
                          branchId,
                          branchLabel: event.branch_label || (branchId === "root" ? "main" : branchId),
                          timestamp: Date.now(),
                          runId: backendMessage.run_id || runId,
                        };
                        emit({
                          type: 'message',
                          content: chatMessage,
                          messageId,
                          branchId,
                          branchLabel: event.branch_label,
                          runId,
                        });

                        if (role === 'assistant' && backendMessage.content) {
                          closeBranchMessage(branchId);
                        }
                      }
                    } else if (event.type === 'task_branch_map') {
                      const mapping = event.content as TaskBranchMapContent;
                      const mappedBranchId = toBranchKey(mapping.branchId);
                      if (DEBUG_TASK_BRANCH_MAP) {
                        console.log(
                          `[task-branch-map] route toolCallId=${mapping.toolCallId} branchId=${mappedBranchId}`
                        );
                      }
                      emit({
                        type: 'task_branch_map',
                        content: {
                          toolCallId: mapping.toolCallId,
                          branchId: mappedBranchId,
                        },
                        branchId: mappedBranchId,
                        runId,
                      });
                    } else if (event.type === 'token') {
                      const messageId = ensureBranchMessage(branchId, messageIdFromEventRaw);
                      emit({
                        type: 'token',
                        content: event.content,
                        messageId,
                        branchId,
                        branchLabel: event.branch_label,
                        runId,
                      });
                    } else if (event.type === 'reasoning') {
                      const messageId = ensureBranchMessage(branchId, messageIdFromEventRaw);
                      emit({
                        type: 'reasoning',
                        content: event.content,
                        messageId,
                        branchId,
                        branchLabel: event.branch_label,
                        runId,
                      });
                    } else if (event.type === 'tool_call') {
                      const messageId = ensureBranchMessage(branchId, messageIdFromEventRaw);
                      const toolCall = event.content as { id?: string };
                      rememberToolCallBranch(toolCall.id, branchId);
                      emit({
                        type: 'tool_call',
                        content: event.content,
                        messageId,
                        branchId,
                        branchLabel: event.branch_label,
                        runId,
                      });
                    } else if (event.type === 'tool_result') {
                      const messageId = ensureBranchMessage(branchId, messageIdFromEventRaw);
                      const result = event.content as { toolCallId?: string };
                      emit({
                        type: 'tool_result',
                        content: event.content,
                        messageId,
                        branchId,
                        branchLabel: event.branch_label,
                        runId,
                      });
                      closeToolCallMessage(result.toolCallId);
                      closeBranchMessage(branchId);
                    } else if (event.type === 'error') {
                      emit({
                        type: 'error',
                        content: event.content,
                        branchId,
                        branchLabel: event.branch_label,
                        runId,
                      });
                    }
                  } catch {
                    console.error('Failed to parse SSE data:', data);
                    continue;
                  }
                }
              }
            } finally {
              reader.releaseLock();
            }
          } catch (error) {
            console.error('Streaming error:', error);
            const errorChunk = encoder.encode(`data: ${JSON.stringify({ type: 'error', content: 'Stream failed' })}\n\n`);
            controller.enqueue(errorChunk);
            controller.close();
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // Handle non-streaming response
      const userInput = {
        message,
        thread_id: threadId,
        user_id: userId,
        model,
      };

      const endpoint = agentId ? `/${agentId}/invoke` : '/invoke';
      const backendResponse = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(userInput),
      });

      if (!backendResponse.ok) {
        throw new Error(`Backend request failed: ${backendResponse.status}`);
      }

      const response: BackendMessage = await backendResponse.json();

      const chatMessage: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random()}`,
        role: response.type === 'human' ? 'user' : 'assistant',
        content: response.content,
        reasoningContent: response.reasoning_content,
        partOrder: response.type === 'ai' ? ['text'] : undefined,
        timestamp: Date.now(),
        runId: response.run_id,
      };

      // Handle tool calls in non-streaming mode
      if (response.tool_calls && response.tool_calls.length > 0) {
        const batchId = response.tool_calls.length > 1
          ? `tool-batch-${chatMessage.id}`
          : undefined;
        chatMessage.toolCalls = response.tool_calls.map(tc => ({
          id: tc.id || `tool-${Date.now()}-${Math.random()}`,
          name: tc.name,
          args: tc.args,
          groupId: batchId,
        }));
        chatMessage.partOrder = [
          ...(chatMessage.partOrder ?? []),
          ...chatMessage.toolCalls.map(tc => `tool:${tc.id}`),
        ];
      }

      return NextResponse.json(chatMessage);
    }
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
}
