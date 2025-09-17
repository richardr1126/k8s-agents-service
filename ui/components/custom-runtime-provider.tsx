import { 
  useExternalStoreRuntime, 
  ThreadMessageLike, 
  AppendMessage,
  AssistantRuntimeProvider,
  ExternalStoreAdapter,
  ExternalStoreThreadListAdapter,
  AddToolResultOptions,
  ToolCallMessagePart
} from "@assistant-ui/react";
import { ReactNode, useState, useCallback, useEffect, createContext, useContext, useMemo } from "react";
import { apiClient } from "@/lib/api-client";
import { ChatMessage, BackendMessage } from "@/lib/types";
import { ReadonlyJSONObject, ReadonlyJSONValue } from "assistant-stream/utils";
import { generateThreadTitle } from "@/lib/thread-utils";
import { useUser } from "@/components/auth-user-provider";
import { useServiceInfo } from "@/components/service-info-provider";

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
        args: { taskData: message.customData.taskData } as ToolCallMessagePart["args"],
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
        args: toolCall.args as ToolCallMessagePart["args"],
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
  const { userData, isLoading: userLoading, updateThreadAgent, updateThreadModel, switchToThread } = useUser();
  const { serviceInfo } = useServiceInfo();
  
  const [threads, setThreads] = useState<Map<string, ChatMessage[]>>(new Map());
  const [loadedThreads, setLoadedThreads] = useState<Set<string>>(new Set());
  const [runningThreads, setRunningThreads] = useState<Set<string>>(new Set());

  // Always use the most recent thread (by timestamp) from user data
  const getMostRecentThread = () => {
    if (!userData?.threads || userData.threads.length === 0) return null;
    const activeThreads = userData.threads.filter(t => !t.archived);
    if (activeThreads.length === 0) return null;
    // Sort by timestamp descending and return the first (most recent)
    return activeThreads.sort((a, b) => b.timestamp - a.timestamp)[0];
  };

  const mostRecentThread = getMostRecentThread();
  const currentThreadId = userData?.currentThreadId || mostRecentThread?.id || null;
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

  // Set defaults when service info is loaded and we have a current thread
  useEffect(() => {
    if (serviceInfo && currentThreadId) {
      // Set default agent if none selected
      if (!selectedAgentId && serviceInfo.default_agent) {
        updateThreadAgent(currentThreadId, serviceInfo.default_agent);
      }
      // Set default model if none selected
      if (!selectedModelId && serviceInfo.default_model) {
        updateThreadModel(currentThreadId, serviceInfo.default_model);
      }
    }
  }, [serviceInfo, currentThreadId, selectedAgentId, selectedModelId, updateThreadAgent, updateThreadModel]); // Add missing dependencies

  // Auto-switch to most recent thread if current thread is not set or invalid
  useEffect(() => {
    if (!userLoading && userData && mostRecentThread) {
      if (!userData.currentThreadId || !userData.threads.find(t => t.id === userData.currentThreadId && !t.archived)) {
        switchToThread(mostRecentThread.id);
      }
    }
  }, [userData, mostRecentThread, userLoading, switchToThread]);

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
    switchToThread(id);
  }, [switchToThread]);

  return (
    <ThreadContext.Provider 
      value={{ 
        currentThreadId, 
        setCurrentThreadId, 
        threads, 
        setThreads, 
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
    userId,
    selectedAgentId,
    selectedModelId,
    runningThreads,
    setRunningThreads
  } = useThreadContext();
  
  const { serviceInfo } = useServiceInfo();
  
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
          const messageData = event.content as BackendMessage;
          
          // Check if this is a custom message (task update)
          if (messageData.type === 'custom' && messageData.custom_data) {
            const taskData = messageData.custom_data as {
              name: string;
              run_id: string;
              state: "new" | "running" | "complete";
              result?: "success" | "error" | null;
              data: ReadonlyJSONObject;
            };
            
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
          
          const message = messageData as unknown as ChatMessage;
          
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
          const toolCall = event.content as { id: string; name: string; args: ReadonlyJSONObject };
          const toolMessage: ChatMessage = {
            id: `tool-${toolCall.id}`,
            role: 'assistant',
            content: '', // Empty content - the tool call will be handled by the UI component
            timestamp: Date.now(),
            toolCalls: [{
              id: toolCall.id,
              name: toolCall.name,
              args: toolCall.args as ReadonlyJSONObject,
            }],
          };

          setThreads(prev => {
            const threadMessages = prev.get(currentThreadId) || [];
            const updatedThreadMessages = [...threadMessages, toolMessage];
            return new Map(prev).set(currentThreadId, updatedThreadMessages);
          });
        } else if (event.type === 'tool_result') {
          // Handle tool result - update the corresponding tool call message
          const result = event.content as { toolCallId: string; result: ReadonlyJSONValue };
          
          setThreads(prev => {
            const threadMessages = prev.get(currentThreadId) || [];
            const updatedThreadMessages = threadMessages.map(msg => {
              if (msg.id === `tool-${result.toolCallId}`) {
                // Update the tool call with the result - keep content empty
                return {
                  ...msg,
                  content: '', // Keep empty - let the ToolFallback component handle display
                  toolCalls: msg.toolCalls?.map(tc => ({ ...tc, result: result.result as ReadonlyJSONValue })),
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
    onSwitchToNewThread: async () => {
      const defaultAgent = serviceInfo?.default_agent;
      const defaultModel = serviceInfo?.default_model;
      const newThreadId = await createNewThread('New Chat', defaultAgent, defaultModel);
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
    onRename: async (threadId, newTitle) => {
      await updateThreadTitle(threadId, newTitle);
    },
    onArchive: async (threadId) => {
      const result = await archiveThread(threadId);
      if (result.success && result.newThreadId) {
        // If a new thread was created, switch to it
        setCurrentThreadId(result.newThreadId);
        switchToThread(result.newThreadId);
        // Also create an empty thread in our local state
        setThreads(prev => new Map(prev).set(result.newThreadId!, []));
      }
    },
    onDelete: async (threadId) => {
      await deleteThread(threadId);
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
    <ThreadProvider>
      <ChatWithThreads {...props}>
        {children}
      </ChatWithThreads>
    </ThreadProvider>
  );
}