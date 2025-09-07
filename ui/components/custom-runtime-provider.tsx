"use client";

import { 
  useExternalStoreRuntime, 
  ThreadMessageLike, 
  AppendMessage,
  AssistantRuntimeProvider,
  ExternalStoreAdapter,
  ExternalStoreThreadListAdapter,
  AddToolResultOptions
} from "@assistant-ui/react";
import { ReactNode, useState, useCallback, useEffect, createContext, useContext, useMemo } from "react";
import { apiClient } from "@/lib/frontend-api-client";
import { ChatMessage, BackendServiceMetadata } from "@/lib/types";
import { useUrlState } from "@/hooks/use-url-state";
import { generateThreadTitle } from "@/lib/thread-utils";
import { UserProvider, useUser } from "@/components/user-provider";

// Convert our ChatMessage format to ThreadMessageLike
const convertMessage = (message: ChatMessage): ThreadMessageLike => {
  let content: ThreadMessageLike['content'];

  // Handle custom data (task updates) as tool calls
  if (message.customData?.taskData) {
    content = [
      {
        type: "tool-call" as const,
        toolCallId: message.customData.taskData.run_id,
        toolName: "task_update",
        args: { taskData: message.customData.taskData },
        result: undefined, // Task updates don't have results
      }
    ];
  }
  // Add tool calls if they exist
  else if (message.toolCalls && message.toolCalls.length > 0) {
    content = [
      ...message.toolCalls.map(toolCall => ({
        type: "tool-call" as const,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args: toolCall.args as any, // AssistantUI expects ReadonlyJSONObject but our type is Record<string, unknown>
        result: toolCall.result,
      })),
      // Only add text content if it exists and is not empty
      ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    ];
  } else {
    content = [{ type: "text", text: message.content }];
  }

  return {
    id: message.id,
    role: message.role,
    content,
    createdAt: new Date(message.timestamp),
  };
};

interface ThreadContextType {
  currentThreadId: string | null;
  setCurrentThreadId: (id: string) => void;
  threads: Map<string, ChatMessage[]>;
  setThreads: React.Dispatch<React.SetStateAction<Map<string, ChatMessage[]>>>;
  serviceInfo: BackendServiceMetadata | null;
  userId: string | null;
  selectedAgentId: string | null;
  setSelectedAgentId: (agentId: string) => void;
  selectedModelId: string | null;
  setSelectedModelId: (modelId: string) => void;
  runningThreads: Set<string>;
  setRunningThreads: React.Dispatch<React.SetStateAction<Set<string>>>;
}

const ThreadContext = createContext<ThreadContextType>({
  currentThreadId: null,
  setCurrentThreadId: () => {},
  threads: new Map(),
  setThreads: () => {},
  serviceInfo: null,
  userId: null,
  selectedAgentId: null,
  setSelectedAgentId: () => {},
  selectedModelId: null,
  setSelectedModelId: () => {},
  runningThreads: new Set(),
  setRunningThreads: () => {},
});

export const useThreadContext = () => {
  const context = useContext(ThreadContext);
  if (!context) {
    throw new Error("useThreadContext must be used within ThreadProvider");
  }
  return context;
};

interface ThreadProviderProps {
  children: ReactNode;
}

function ThreadProvider({ children }: ThreadProviderProps) {
  const { userData, isLoading: userLoading, updateThreadAgent, updateThreadModel } = useUser();
  const { threadId: urlThreadId, setThreadId: setUrlThreadId } = useUrlState();
  
  const [threads, setThreads] = useState<Map<string, ChatMessage[]>>(new Map());
  const [loadedThreads, setLoadedThreads] = useState<Set<string>>(new Set());
  const [serviceInfo, setServiceInfo] = useState<BackendServiceMetadata | null>(null);
  const [runningThreads, setRunningThreads] = useState<Set<string>>(new Set());

  // Determine current thread ID from URL or user data
  const currentThreadId = urlThreadId || userData?.currentThreadId || null;
  const userId = userData?.userId || null;
  
  // Get the selected agent and model for the current thread
  const currentThread = userData?.threads?.find(t => t.id === currentThreadId);
  const selectedAgentId = currentThread?.agentId || null;
  const selectedModelId = currentThread?.modelId || null;

  // Function to update agent selection for current thread
  const setSelectedAgentId = useCallback((agentId: string) => {
    if (currentThreadId) {
      updateThreadAgent(currentThreadId, agentId);
    }
  }, [currentThreadId, updateThreadAgent]);

  // Function to update model selection for current thread
  const setSelectedModelId = useCallback((modelId: string) => {
    if (currentThreadId) {
      updateThreadModel(currentThreadId, modelId);
    }
  }, [currentThreadId, updateThreadModel]);

  // Load service info on mount
  useEffect(() => {
    apiClient.getServiceInfo()
      .then((info) => {
        setServiceInfo(info);
        // Set default agent and model for current thread if none selected
        if (currentThreadId) {
          if (!selectedAgentId && info.default_agent) {
            updateThreadAgent(currentThreadId, info.default_agent);
          }
          if (!selectedModelId && info.default_model) {
            updateThreadModel(currentThreadId, info.default_model);
          }
        }
      })
      .catch(console.error);
  }, [currentThreadId, selectedAgentId, selectedModelId, updateThreadAgent, updateThreadModel]);

  // Sync URL with user data when user data changes
  useEffect(() => {
    if (!userLoading && userData && !urlThreadId && userData.currentThreadId) {
      setUrlThreadId(userData.currentThreadId);
    }
  }, [userData, urlThreadId, setUrlThreadId, userLoading]);

  // Load chat history when thread changes, but only if we haven't already tried to load it
  useEffect(() => {
    if (currentThreadId && !threads.has(currentThreadId) && !loadedThreads.has(currentThreadId)) {
      // Mark this thread as being loaded to prevent duplicate requests
      setLoadedThreads(prev => new Set(prev).add(currentThreadId));
      
      apiClient.getChatHistory(currentThreadId)
        .then(({ messages }) => {
          setThreads(prev => new Map(prev).set(currentThreadId, messages));
        })
        .catch(error => {
          console.warn(`Failed to load history for thread ${currentThreadId}:`, error);
          // Set empty array so we don't try to load again
          setThreads(prev => new Map(prev).set(currentThreadId, []));
        });
    }
  }, [currentThreadId, threads, loadedThreads]);

  const setCurrentThreadId = useCallback((id: string) => {
    setUrlThreadId(id);
  }, [setUrlThreadId]);

  return (
    <ThreadContext.Provider 
      value={{ 
        currentThreadId, 
        setCurrentThreadId, 
        threads, 
        setThreads, 
        serviceInfo,
        userId,
        selectedAgentId,
        setSelectedAgentId,
        selectedModelId,
        setSelectedModelId,
        runningThreads,
        setRunningThreads
      }}
    >
      {children}
    </ThreadContext.Provider>
  );
}

interface CustomRuntimeProviderProps {
  children: ReactNode;
}

function ChatWithThreads({
  children,
}: CustomRuntimeProviderProps) {
  const { 
    currentThreadId, 
    setCurrentThreadId, 
    threads, 
    setThreads, 
    serviceInfo,
    userId,
    selectedAgentId,
    selectedModelId,
    runningThreads,
    setRunningThreads
  } = useThreadContext();
  
  const { 
    userData, 
    createNewThread, 
    switchToThread, 
    updateThreadTitle, 
    updateThreadActivity, 
    archiveThread, 
    deleteThread,
    activeThreads,
    archivedThreads
  } = useUser();
  
  // Check if current thread is running
  const isRunning = currentThreadId ? runningThreads.has(currentThreadId) : false;

  // Get messages for current thread
  const currentMessages = useMemo(
    () => currentThreadId ? threads.get(currentThreadId) || [] : [],
    [currentThreadId, threads]
  );

  // Convert user threads to thread list format with loading state
  const threadList = activeThreads.map(thread => ({
    threadId: thread.id,
    status: "regular" as const,
    title: thread.title,
    isLoading: runningThreads.has(thread.id),
  }));

  const archivedThreadList = archivedThreads.map(thread => ({
    threadId: thread.id,
    status: "archived" as const,
    title: thread.title,
    isLoading: runningThreads.has(thread.id),
  }));

  const onAddToolResult = useCallback((options: AddToolResultOptions) => {
    if (!currentThreadId) return;

    setThreads((prev) => {
      const threadMessages = prev.get(currentThreadId) || [];
      const updatedMessages = threadMessages.map((message) => {
        if (message.id === options.messageId && message.toolCalls) {
          return {
            ...message,
            toolCalls: message.toolCalls.map((toolCall) => {
              if (toolCall.id === options.toolCallId) {
                return {
                  ...toolCall,
                  result: options.result,
                };
              }
              return toolCall;
            }),
          };
        }
        return message;
      });
      return new Map(prev).set(currentThreadId, updatedMessages);
    });
  }, [currentThreadId, setThreads]);

  const onNew = useCallback(async (message: AppendMessage) => {
    if (!currentThreadId || !userId) return;
    
    if (message.content[0]?.type !== "text") {
      throw new Error("Only text messages are supported");
    }

    const userMessageText = message.content[0].text;
    
    // Add user message optimistically
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessageText,
      timestamp: Date.now(),
    };

    const updatedMessages = [...currentMessages, userMessage];
    setThreads(prev => new Map(prev).set(currentThreadId, updatedMessages));
    setRunningThreads(prev => new Set(prev).add(currentThreadId));

    // Update thread activity
    updateThreadActivity(currentThreadId, userMessageText.substring(0, 50) + (userMessageText.length > 50 ? '...' : ''));

    // Auto-update thread title if it's still "New Chat" and this is the first user message
    const userMessageCount = currentMessages.filter(m => m.role === 'user').length;
    if (userMessageCount === 0) {
      const currentThread = userData?.threads?.find(t => t.id === currentThreadId);
      if (currentThread?.title === 'New Chat') {
        const newTitle = generateThreadTitle(userMessageText);
        updateThreadTitle(currentThreadId, newTitle);
      }
    }

    try {
      // Stream the response
      let fullContent = "";
      const streamRequest = {
        message: userMessageText,
        threadId: currentThreadId,
        userId: userId,
        agentId: selectedAgentId || serviceInfo?.default_agent,
        model: selectedModelId || serviceInfo?.default_model,
      };

      for await (const eventData of apiClient.streamMessage(streamRequest)) {
        const event = eventData as {
          type: 'token' | 'message' | 'tool_call' | 'tool_result' | 'error';
          content: unknown;
          messageId?: string;
        };
        
        if (event.type === 'token') {
          const messageId = event.messageId;
          fullContent += event.content;
          
          // Update the specific message being streamed
          setThreads(prev => {
            const threadMessages = prev.get(currentThreadId) || [];
            const updatedThreadMessages = threadMessages.map(msg => 
              msg.id === messageId
                ? { ...msg, content: fullContent }
                : msg
            );
            return new Map(prev).set(currentThreadId, updatedThreadMessages);
          });
        } else if (event.type === 'message') {
          // Handle complete message (assistant text messages and custom messages)
          const messageData = event.content as any;
          
          // Check if this is a custom message (task update)
          if (messageData.type === 'custom' && messageData.custom_data) {
            const taskData = messageData.custom_data;
            
            const taskMessage: ChatMessage = {
              id: `task-${taskData.run_id}`,
              role: 'assistant',
              content: '', // Empty content for custom messages
              timestamp: Date.now(),
              customData: { taskData }
            };

            setThreads(prev => {
              const threadMessages = prev.get(currentThreadId) || [];
              // Check if we already have this task update, replace if so
              const existingIndex = threadMessages.findIndex(msg => 
                msg.customData?.taskData?.run_id === taskData.run_id
              );
              
              let updatedThreadMessages;
              if (existingIndex !== -1) {
                updatedThreadMessages = threadMessages.map((msg, idx) => 
                  idx === existingIndex ? taskMessage : msg
                );
              } else {
                updatedThreadMessages = [...threadMessages, taskMessage];
              }
              
              return new Map(prev).set(currentThreadId, updatedThreadMessages);
            });
            
            continue; // Continue processing the stream
          }
          
          const message = messageData as ChatMessage;
          
          // If this is a new streaming message placeholder, reset content
          if (message.content === '') {
            fullContent = '';
          }
          
          setThreads(prev => {
            const threadMessages = prev.get(currentThreadId) || [];
            // Replace or append the message
            const existingIndex = threadMessages.findIndex(msg => msg.id === message.id);
            let updatedThreadMessages;
            
            if (existingIndex !== -1) {
              updatedThreadMessages = threadMessages.map(msg => 
                msg.id === message.id ? message : msg
              );
            } else {
              updatedThreadMessages = [...threadMessages, message];
            }
            
            return new Map(prev).set(currentThreadId, updatedThreadMessages);
          });

          // Update thread activity with assistant's response
          if (message.content && message.role === 'assistant') {
            updateThreadActivity(currentThreadId, message.content.substring(0, 50) + (message.content.length > 50 ? '...' : ''));
          }
        } else if (event.type === 'tool_call') {
          // Handle tool call - create a new "message" for the tool call
          const toolCall = event.content as { id: string; name: string; args: Record<string, unknown> };
          const toolMessage: ChatMessage = {
            id: `tool-${toolCall.id}`,
            role: 'assistant',
            content: '', // Empty content - the tool call will be handled by the UI component
            timestamp: Date.now(),
            toolCalls: [{
              id: toolCall.id,
              name: toolCall.name,
              args: toolCall.args,
            }],
          };

          setThreads(prev => {
            const threadMessages = prev.get(currentThreadId) || [];
            const updatedThreadMessages = [...threadMessages, toolMessage];
            return new Map(prev).set(currentThreadId, updatedThreadMessages);
          });
        } else if (event.type === 'tool_result') {
          // Handle tool result - update the corresponding tool call message
          const result = event.content as { toolCallId: string; result: unknown };
          
          setThreads(prev => {
            const threadMessages = prev.get(currentThreadId) || [];
            const updatedThreadMessages = threadMessages.map(msg => {
              if (msg.id === `tool-${result.toolCallId}`) {
                // Update the tool call with the result - keep content empty
                return {
                  ...msg,
                  content: '', // Keep empty - let the ToolFallback component handle display
                  toolCalls: msg.toolCalls?.map(tc => ({ ...tc, result: result.result })),
                };
              }
              return msg;
            });
            return new Map(prev).set(currentThreadId, updatedThreadMessages);
          });
        } else if (event.type === 'error') {
          console.error('Stream error:', event.content);
          setThreads(prev => {
            const threadMessages = prev.get(currentThreadId) || [];
            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${event.content}`,
              timestamp: Date.now(),
            };
            const updatedThreadMessages = [...threadMessages, errorMessage];
            return new Map(prev).set(currentThreadId, updatedThreadMessages);
          });
          break;
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      // Add error message
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "Sorry, I encountered an error processing your message.",
        timestamp: Date.now(),
      };
      setThreads(prev => {
        const threadMessages = prev.get(currentThreadId) || [];
        const errorMessages = [...threadMessages, errorMessage];
        return new Map(prev).set(currentThreadId, errorMessages);
      });
    } finally {
      setRunningThreads(prev => {
        const next = new Set(prev);
        next.delete(currentThreadId);
        return next;
      });
    }
  }, [currentThreadId, currentMessages, userId, selectedAgentId, selectedModelId, serviceInfo, setThreads, setRunningThreads, updateThreadActivity, updateThreadTitle, userData]);

  const threadListAdapter: ExternalStoreThreadListAdapter = {
    threadId: currentThreadId || '',
    threads: threadList,
    archivedThreads: archivedThreadList,
    onSwitchToNewThread: () => {
      const defaultAgent = serviceInfo?.default_agent;
      const defaultModel = serviceInfo?.default_model;
      const newThreadId = createNewThread('New Chat', defaultAgent, defaultModel);
      if (newThreadId) {
        setThreads(prev => new Map(prev).set(newThreadId, []));
        setCurrentThreadId(newThreadId);
        switchToThread(newThreadId);
      }
    },
    onSwitchToThread: (threadId) => {
      setCurrentThreadId(threadId);
      switchToThread(threadId);
    },
    onRename: (threadId, newTitle) => {
      updateThreadTitle(threadId, newTitle);
    },
    onArchive: (threadId) => {
      const result = archiveThread(threadId);
      if (result.success && result.newThreadId) {
        // If a new thread was created, switch to it and update the URL
        setCurrentThreadId(result.newThreadId);
        switchToThread(result.newThreadId);
        // Also create an empty thread in our local state
        setThreads(prev => new Map(prev).set(result.newThreadId!, []));
      }
    },
    onDelete: (threadId) => {
      deleteThread(threadId);
      setThreads(prev => {
        const next = new Map(prev);
        next.delete(threadId);
        return next;
      });
    },
  };

  const adapter: ExternalStoreAdapter<ChatMessage> = {
    messages: currentMessages,
    isRunning,
    onNew,
    onAddToolResult,
    convertMessage,
    setMessages: (messages) => {
      if (currentThreadId) {
        setThreads(prev => new Map(prev).set(currentThreadId, messages));
      }
    },
    adapters: {
      threadList: threadListAdapter,
    },
    // Add other handlers as needed
    // onEdit: async (message) => { /* handle edit */ },
    // onReload: async (parentId) => { /* handle reload */ },
    // onCancel: async () => { /* handle cancel */ },
  };

  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

export function CustomRuntimeProvider({
  children,
  ...props
}: CustomRuntimeProviderProps) {
  return (
    <UserProvider>
      <ThreadProvider>
        <ChatWithThreads {...props}>
          {children}
        </ChatWithThreads>
      </ThreadProvider>
    </UserProvider>
  );
}