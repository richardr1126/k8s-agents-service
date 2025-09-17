import { NextRequest, NextResponse } from 'next/server';
import { ChatRequest, ChatMessage, BackendMessage, BackendStreamEvent } from '@/lib/types';
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

    const body: ChatRequest = await req.json();
    const { message, threadId, agentId, model, stream } = body;

    // Use authenticated user ID instead of client-provided userId
    const userId = session.user.id;

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
            let streamingMessageId: string | null = null;

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
                  if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    
                    if (data === '[DONE]') {
                      const doneChunk = encoder.encode('data: [DONE]\n\n');
                      controller.enqueue(doneChunk);
                      controller.close();
                      return;
                    }

                    try {
                      const event = JSON.parse(data) as BackendStreamEvent;
                      
                      if (event.type === 'message' && typeof event.content === 'object') {
                        const backendMessage = event.content as BackendMessage;
                        
                        // Handle custom messages (task updates)
                        if (backendMessage.type === 'custom' && backendMessage.custom_data) {
                          // Forward custom messages directly - they'll be handled by the frontend
                          const chunk = encoder.encode(`data: ${JSON.stringify({ type: 'message', content: backendMessage })}\n\n`);
                          controller.enqueue(chunk);
                          continue;
                        }
                        
                        // Handle tool result messages - emit as separate tool result events
                        if (backendMessage.type === 'tool' && backendMessage.tool_call_id) {
                          const chunk = encoder.encode(`data: ${JSON.stringify({ 
                            type: 'tool_result', 
                            content: {
                              toolCallId: backendMessage.tool_call_id,
                              result: backendMessage.content
                            }
                          })}\n\n`);
                          controller.enqueue(chunk);
                          continue;
                        }

                        // Handle AI messages (both tool calls and regular responses)
                        if (backendMessage.type === 'ai') {
                          if (backendMessage.tool_calls && backendMessage.tool_calls.length > 0) {
                            // Emit each tool call as a separate event in the stream
                            for (const tc of backendMessage.tool_calls) {
                              const toolCallEvent = {
                                type: 'tool_call',
                                content: {
                                  id: tc.id || `tool-${Date.now()}-${Math.random()}`,
                                  name: tc.name,
                                  args: tc.args,
                                }
                              };
                              const chunk = encoder.encode(`data: ${JSON.stringify(toolCallEvent)}\n\n`);
                              controller.enqueue(chunk);
                            }
                          } 
                          
                          // Handle AI messages with content (final response)
                          if (backendMessage.content) {
                            // This is a final response message - create a new text message
                            const textMessage: ChatMessage = {
                              id: streamingMessageId || `msg-${Date.now()}-${++messageCounter}`,
                              role: 'assistant',
                              content: backendMessage.content,
                              timestamp: Date.now(),
                              runId: backendMessage.run_id,
                            };

                            const chunk = encoder.encode(`data: ${JSON.stringify({ type: 'message', content: textMessage })}\n\n`);
                            controller.enqueue(chunk);
                            streamingMessageId = null; // Reset for next message
                          }
                        } else if (backendMessage.type === 'human') {
                          // Handle human messages (shouldn't happen in streaming but just in case)
                          const chatMessage: ChatMessage = {
                            id: `msg-${Date.now()}-${++messageCounter}`,
                            role: 'user',
                            content: backendMessage.content,
                            timestamp: Date.now(),
                            runId: backendMessage.run_id,
                          };

                          const chunk = encoder.encode(`data: ${JSON.stringify({ type: 'message', content: chatMessage })}\n\n`);
                          controller.enqueue(chunk);
                        }
                      } else if (event.type === 'token') {
                        // Create a streaming message placeholder if we don't have one
                        if (!streamingMessageId) {
                          streamingMessageId = `msg-${Date.now()}-${++messageCounter}`;
                          const placeholder: ChatMessage = {
                            id: streamingMessageId,
                            role: 'assistant',
                            content: '',
                            timestamp: Date.now(),
                          };
                          const chunk = encoder.encode(`data: ${JSON.stringify({ type: 'message', content: placeholder })}\n\n`);
                          controller.enqueue(chunk);
                        }
                        
                        // Forward token updates
                        const chunk = encoder.encode(`data: ${JSON.stringify({ type: 'token', content: event.content, messageId: streamingMessageId })}\n\n`);
                        controller.enqueue(chunk);
                      } else if (event.type === 'error') {
                        const chunk = encoder.encode(`data: ${JSON.stringify({ type: 'error', content: event.content })}\n\n`);
                        controller.enqueue(chunk);
                      }
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
        timestamp: Date.now(),
        runId: response.run_id,
      };

      // Handle tool calls in non-streaming mode
      if (response.tool_calls && response.tool_calls.length > 0) {
        chatMessage.toolCalls = response.tool_calls.map(tc => ({
          id: tc.id || `tool-${Date.now()}-${Math.random()}`,
          name: tc.name,
          args: tc.args,
        }));
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
