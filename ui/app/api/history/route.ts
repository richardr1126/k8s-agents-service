import { NextRequest, NextResponse } from 'next/server';
import { createBackendClient } from '@/lib/backend-client';
import { ChatMessage, ToolCall } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { threadId }: { threadId: string } = await req.json();
    
    if (!threadId) {
      return NextResponse.json(
        { error: 'Thread ID is required' },
        { status: 400 }
      );
    }

    const backendClient = createBackendClient();
    
    try {
      const history = await backendClient.getChatHistory(threadId);
      
      // Convert backend messages to frontend format
      // We need to combine tool calls with their results from separate messages
      const messages: ChatMessage[] = [];
      const toolCallResults = new Map<string, string>();
      
      // First pass: collect tool results
      for (const msg of history.messages) {
        if (msg.type === 'tool' && msg.tool_call_id) {
          toolCallResults.set(msg.tool_call_id, msg.content);
        }
      }
      
      // Second pass: create chat messages and attach tool results
      let messageIndex = 0;
      for (const msg of history.messages) {
        // Skip tool messages as they're combined with AI messages
        if (msg.type === 'tool') continue;
        
        const chatMessage: ChatMessage = {
          id: `msg-${threadId}-${messageIndex++}`,
          role: msg.type === 'human' ? 'user' : 'assistant',
          content: msg.content,
          timestamp: Date.now() - ((history.messages.length - messageIndex) * 60000), // Mock timestamps
          runId: msg.run_id,
        };

        // Handle tool calls and attach their results
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          chatMessage.toolCalls = msg.tool_calls.map(tc => {
            const toolCall: ToolCall = {
              id: tc.id || `tool-${Date.now()}-${Math.random()}`,
              name: tc.name,
              args: tc.args,
            };
            
            if (tc.id) {
              const result = toolCallResults.get(tc.id);
              if (result !== undefined) {
                toolCall.result = result;
              }
            }
            
            return toolCall;
          });
        }

        messages.push(chatMessage);
      }

      return NextResponse.json({ messages });
    } catch {
      // If the backend returns an error (e.g., thread doesn't exist), return empty messages
      console.log(`Thread ${threadId} not found in backend or has no messages, returning empty history`);
      return NextResponse.json({ messages: [] });
    }
  } catch (error) {
    console.error('History API error:', error);
    return NextResponse.json(
      { error: 'Failed to get chat history' },
      { status: 500 }
    );
  }
}