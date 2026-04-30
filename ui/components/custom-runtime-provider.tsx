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
import { ReactNode, useState, useCallback, useEffect, createContext, useContext, useMemo, useRef } from "react";
import { apiClient } from "@/lib/api-client";
import {
  ChatMessage,
  BackendMessage,
  ReadonlyJSONObject,
  ReadonlyJSONValue,
  ROOT_BRANCH_ID,
  normalizeBranchId,
  TaskBranchMapContent,
} from "@/lib/types";
import { generateThreadTitle } from "@/lib/thread-utils";
import { useUser } from "@/components/auth-user-provider";
import { useServiceInfo } from "@/components/service-info-provider";
import { useRateLimit } from "@/components/rate-limit-provider";
import { useIsMobile } from "@/hooks/use-mobile";
const DEBUG_TASK_BRANCH_MAP = process.env.NEXT_PUBLIC_DEBUG_TASK_BRANCH_MAP === "1";
export { ROOT_BRANCH_ID } from "@/lib/types";

// Convert our ChatMessage format to ThreadMessageLike
const appendReasoningChunk = (current: string, chunk: string): string => {
  if (chunk === "") return current;
  if (!current) return chunk;
  if (chunk === current) return current;
  if (chunk.startsWith(current)) return chunk;
  if (current.startsWith(chunk)) return current;
  return `${current}${chunk}`;
};

const combineReasoningChunks = (chunks: string[] | undefined): string => {
  if (!chunks || chunks.length === 0) return "";
  let text = "";
  for (const chunk of chunks) {
    text = appendReasoningChunk(text, chunk);
  }
  return text;
};

const mergeReasoningChunks = (left?: string[], right?: string[]): string[] | undefined => {
  const merged = [...(left ?? []), ...(right ?? [])];
  if (merged.length === 0) return undefined;
  const deduped: string[] = [];
  for (const item of merged) {
    if (!deduped.includes(item)) deduped.push(item);
  }
  return deduped;
};

const appendPartOrderMarker = (current: string[] | undefined, marker: string): string[] => {
  const next = [...(current ?? [])];
  if (!next.includes(marker)) {
    next.push(marker);
  }
  return next;
};

const mergePartOrder = (left?: string[], right?: string[]): string[] | undefined => {
  if (!left?.length && !right?.length) return undefined;
  const merged: string[] = [];
  for (const marker of [...(left ?? []), ...(right ?? [])]) {
    if (!merged.includes(marker)) merged.push(marker);
  }
  return merged;
};

const isBackendCustomMessage = (value: unknown): value is BackendMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BackendMessage>;
  return candidate.type === "custom" && typeof candidate.custom_data === "object";
};

const isChatMessagePayload = (value: unknown): value is ChatMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatMessage>;
  return (
    typeof candidate.id === "string"
    && (candidate.role === "assistant" || candidate.role === "user")
    && typeof candidate.content === "string"
    && typeof candidate.timestamp === "number"
  );
};

type StreamEvent = {
  type: 'token' | 'reasoning' | 'message' | 'tool_call' | 'tool_result' | 'task_branch_map' | 'error';
  content: unknown;
  messageId?: string;
  branchId?: string;
  branchLabel?: string;
};

const updateThreadMessages = (
  prev: Map<string, ChatMessage[]>,
  threadId: string,
  updater: (messages: ChatMessage[]) => ChatMessage[],
): Map<string, ChatMessage[]> => {
  const current = prev.get(threadId) || [];
  const next = updater(current);
  return new Map(prev).set(threadId, next);
};

const upsertTokenMessage = (
  messages: ChatMessage[],
  options: {
    messageId: string;
    content: string;
    branchId: string;
    branchLabel?: string;
  },
): ChatMessage[] => {
  const { messageId, content, branchId, branchLabel } = options;
  const existingIndex = messages.findIndex(msg => msg.id === messageId);
  if (existingIndex !== -1) {
    return messages.map(msg =>
      msg.id === messageId
        ? { ...msg, content, partOrder: appendPartOrderMarker(msg.partOrder, "text") }
        : msg
    );
  }
  return [
    ...messages,
    {
      id: messageId,
      role: 'assistant',
      content,
      partOrder: ["text"],
      branchId,
      branchLabel,
      timestamp: Date.now(),
    },
  ];
};

const upsertReasoningMessage = (
  messages: ChatMessage[],
  options: {
    messageId: string;
    reasoningChunk: string;
    branchId: string;
    branchLabel?: string;
  },
): ChatMessage[] => {
  const { messageId, reasoningChunk, branchId, branchLabel } = options;
  const existingIndex = messages.findIndex(msg => msg.id === messageId);
  if (existingIndex !== -1) {
    return messages.map(msg => {
      if (msg.id !== messageId) return msg;
      return {
        ...msg,
        reasoningContent: [...(msg.reasoningContent ?? []), reasoningChunk],
        partOrder: appendPartOrderMarker(msg.partOrder, "reasoning"),
      };
    });
  }
  return [
    ...messages,
    {
      id: messageId,
      role: 'assistant',
      content: '',
      reasoningContent: [reasoningChunk],
      partOrder: ["reasoning"],
      branchId,
      branchLabel,
      timestamp: Date.now(),
    },
  ];
};

const upsertTaskMessage = (
  messages: ChatMessage[],
  taskMessage: ChatMessage,
): ChatMessage[] => {
  const existingIndex = messages.findIndex(msg => msg.customData?.taskData?.run_id === taskMessage.customData?.taskData?.run_id);
  if (existingIndex === -1) {
    return [...messages, taskMessage];
  }
  return messages.map((msg, idx) => (idx === existingIndex ? taskMessage : msg));
};

const upsertAuthoritativeMessage = (
  messages: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] => {
  const existingIndex = messages.findIndex(msg => msg.id === message.id);
  if (existingIndex === -1) {
    return [...messages, message];
  }
  return messages.map(msg => {
    if (msg.id !== message.id) return msg;
    const existingToolCalls = msg.toolCalls ?? [];
    const incomingToolCalls = message.toolCalls ?? [];
    const mergedToolCalls = incomingToolCalls.length > 0
      ? [
        ...incomingToolCalls.map(toolCall => {
          const existingToolCall = existingToolCalls.find(tc => tc.id === toolCall.id);
          return {
            ...existingToolCall,
            ...toolCall,
            result: toolCall.result ?? existingToolCall?.result,
          };
        }),
        ...existingToolCalls.filter(
          existingToolCall => !incomingToolCalls.some(toolCall => toolCall.id === existingToolCall.id),
        ),
      ]
      : existingToolCalls;
    return {
      ...msg,
      ...message,
      toolCalls: mergedToolCalls.length > 0 ? mergedToolCalls : message.toolCalls,
      reasoningContent: mergeReasoningChunks(msg.reasoningContent, message.reasoningContent),
      partOrder: mergePartOrder(msg.partOrder, message.partOrder),
    };
  });
};

const upsertToolCall = (
  messages: ChatMessage[],
  options: {
    targetMessageId: string;
    toolCall: { id: string; name: string; args: ReadonlyJSONObject; batchId?: string; result?: ReadonlyJSONValue };
    branchId: string;
    branchLabel?: string;
  },
): ChatMessage[] => {
  const { targetMessageId, toolCall, branchId, branchLabel } = options;
  const existingIndex = messages.findIndex(msg => msg.id === targetMessageId);
  if (existingIndex !== -1) {
    return messages.map((msg, idx) => {
      if (idx !== existingIndex) return msg;
      const existingToolCalls = msg.toolCalls ?? [];
      const toolCallIndex = existingToolCalls.findIndex(tc => tc.id === toolCall.id);
      if (toolCallIndex !== -1) {
        return {
          ...msg,
          toolCalls: existingToolCalls.map((tc, tcIndex) => (
            tcIndex === toolCallIndex
              ? {
                ...tc,
                name: toolCall.name,
                args: toolCall.args,
                groupId: toolCall.batchId ?? tc.groupId,
                result: toolCall.result ?? tc.result,
              }
              : tc
          )),
          partOrder: appendPartOrderMarker(msg.partOrder, `tool:${toolCall.id}`),
        };
      }
      return {
        ...msg,
        toolCalls: [
          ...existingToolCalls,
          {
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.args,
            groupId: toolCall.batchId,
            result: toolCall.result,
          },
        ],
        partOrder: appendPartOrderMarker(msg.partOrder, `tool:${toolCall.id}`),
      };
    });
  }
  return [
    ...messages,
    {
      id: targetMessageId,
      role: 'assistant',
      content: '',
      branchId,
      branchLabel,
      timestamp: Date.now(),
      toolCalls: [
        {
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.args,
          groupId: toolCall.batchId,
        },
      ],
      partOrder: [`tool:${toolCall.id}`],
    },
  ];
};

const upsertToolResult = (
  messages: ChatMessage[],
  options: {
    targetMessageId: string;
    toolCallId: string;
    result: ReadonlyJSONValue;
    branchId: string;
    branchLabel?: string;
  },
): ChatMessage[] => {
  const { targetMessageId, toolCallId, result, branchId, branchLabel } = options;
  let matched = false;
  const updatedMessages = messages.map(msg => {
    if (msg.toolCalls?.some(tc => tc.id === toolCallId)) {
      matched = true;
      return {
        ...msg,
        toolCalls: msg.toolCalls?.map(tc => (
          tc.id === toolCallId ? { ...tc, result } : tc
        )),
        partOrder: appendPartOrderMarker(msg.partOrder, `tool:${toolCallId}`),
      };
    }
    return msg;
  });

  if (matched) return updatedMessages;

  return [
    ...updatedMessages,
    {
      id: targetMessageId,
      role: 'assistant',
      content: '',
      branchId,
      branchLabel,
      timestamp: Date.now(),
      toolCalls: [
        {
          id: toolCallId,
          name: 'tool',
          args: {} as ReadonlyJSONObject,
          result,
        },
      ],
      partOrder: [`tool:${toolCallId}`],
    },
  ];
};

type MessageContentParts = Exclude<ThreadMessageLike["content"], string>;
type MessageContentPart = MessageContentParts[number];
type ToolContentPart = Extract<MessageContentPart, { type: "tool-call" }>;
type TextContentPart = Extract<MessageContentPart, { type: "text" }>;
type ReasoningContentPart = Extract<MessageContentPart, { type: "reasoning" }>;

const toReasoningPart = (text: string): ReasoningContentPart => ({ type: "reasoning", text });
const toTextPart = (text: string): TextContentPart => ({ type: "text", text });
const toToolPart = (toolCall: NonNullable<ChatMessage["toolCalls"]>[number]): ToolContentPart => ({
  type: "tool-call",
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  args: toolCall.args as ToolCallMessagePart["args"],
  result: toolCall.result,
  parentId: toolCall.groupId,
});

export const convertMessage = (message: ChatMessage): ThreadMessageLike => {
  let content: ThreadMessageLike['content'];
  const reasoningText = combineReasoningChunks(message.reasoningContent);
  const reasoningPart = reasoningText ? toReasoningPart(reasoningText) : null;
  const textPart = message.content ? toTextPart(message.content) : null;
  const toolParts = (message.toolCalls ?? []).map(toToolPart);

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
  else if (message.partOrder && message.partOrder.length > 0) {
    const orderedParts: MessageContentPart[] = [];
    const emittedToolIds = new Set<string>();
    let emittedReasoning = false;
    let emittedText = false;

    for (const marker of message.partOrder ?? []) {
      if (marker === "reasoning" && reasoningPart && !emittedReasoning) {
        orderedParts.push(reasoningPart);
        emittedReasoning = true;
        continue;
      }
      if (marker === "text" && textPart && !emittedText) {
        orderedParts.push(textPart);
        emittedText = true;
        continue;
      }
      if (marker.startsWith("tool:")) {
        const toolId = marker.slice("tool:".length);
        const toolPart = toolParts.find(tp => tp.toolCallId === toolId);
        if (toolPart && !emittedToolIds.has(toolId)) {
          orderedParts.push(toolPart);
          emittedToolIds.add(toolId);
        }
      }
    }

    // Preserve streamed order exactly; only fall back when markers are absent.
    if (orderedParts.length === 0) {
      if (reasoningPart && !emittedReasoning) orderedParts.push(reasoningPart);
      for (const toolPart of toolParts) {
        const toolCallId = toolPart.toolCallId;
        if (!toolCallId || !emittedToolIds.has(toolCallId)) orderedParts.push(toolPart);
      }
      if (textPart && !emittedText) orderedParts.push(textPart);
    }

    content = orderedParts;
  } else {
    content = [
      ...(reasoningPart ? [reasoningPart] : []),
      ...toolParts,
      ...(textPart ? [textPart] : []),
    ];
    if (content.length === 0) {
      content = [{ type: "text", text: "" }];
    }
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
  loadedThreads: Set<string>;
  setLoadedThreads: React.Dispatch<React.SetStateAction<Set<string>>>;
  setTaskBranchMapByThread: React.Dispatch<React.SetStateAction<Map<string, Map<string, string>>>>;
  setAvailableBranchByThread: React.Dispatch<React.SetStateAction<Map<string, Set<string>>>>;
  isSubAgentPanelOpen: boolean;
  setSubAgentPanelOpen: (open: boolean) => void;
  selectedSubAgentBranchId: string | null;
  setSelectedSubAgentBranchId: (branchId: string | null) => void;
  openSubAgentBranch: (branchId: string) => void;
  closeSubAgentPanel: () => void;
  resolveTaskBranchId: (toolCallId?: string) => string | null;
  canOpenTaskBranch: (toolCallId?: string) => boolean;
}

const ThreadContext = createContext<ThreadContextType>({
  currentThreadId: null,
  setCurrentThreadId: () => { },
  threads: new Map(),
  setThreads: () => { },
  userId: null,
  selectedAgentId: null,
  setSelectedAgentId: () => { },
  selectedModelId: null,
  setSelectedModelId: () => { },
  runningThreads: new Set(),
  setRunningThreads: () => { },
  loadedThreads: new Set(),
  setLoadedThreads: () => { },
  setTaskBranchMapByThread: () => { },
  setAvailableBranchByThread: () => { },
  isSubAgentPanelOpen: false,
  setSubAgentPanelOpen: () => { },
  selectedSubAgentBranchId: null,
  setSelectedSubAgentBranchId: () => { },
  openSubAgentBranch: () => { },
  closeSubAgentPanel: () => { },
  resolveTaskBranchId: () => null,
  canOpenTaskBranch: () => false,
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
  const [subAgentPanelOpenByThread, setSubAgentPanelOpenByThread] = useState<Map<string, boolean>>(new Map());
  const [selectedSubAgentBranchByThread, setSelectedSubAgentBranchByThread] = useState<Map<string, string | null>>(new Map());
  const [taskBranchMapByThread, setTaskBranchMapByThread] = useState<Map<string, Map<string, string>>>(new Map());
  const [availableBranchByThread, setAvailableBranchByThread] = useState<Map<string, Set<string>>>(new Map());

  // Always use the most recent thread (by timestamp) from user data
  const getMostRecentThread = () => {
    if (!userData?.threads || userData.threads.length === 0) return null;
    // Sort a copy by timestamp descending and return the first (most recent)
    // Avoid mutating state by not sorting the original array in place
    return [...userData.threads].sort((a, b) => b.timestamp - a.timestamp)[0];
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
      if (!userData.currentThreadId || !userData.threads.find(t => t.id === userData.currentThreadId)) {
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

  const isSubAgentPanelOpen = currentThreadId
    ? (subAgentPanelOpenByThread.get(currentThreadId) ?? false)
    : false;
  const selectedSubAgentBranchId = currentThreadId
    ? (selectedSubAgentBranchByThread.get(currentThreadId) ?? null)
    : null;

  const setSubAgentPanelOpen = useCallback((open: boolean) => {
    if (!currentThreadId) return;
    setSubAgentPanelOpenByThread(prev => {
      const next = new Map(prev);
      next.set(currentThreadId, open);
      return next;
    });
  }, [currentThreadId]);

  const setSelectedSubAgentBranchId = useCallback((branchId: string | null) => {
    if (!currentThreadId) return;
    setSelectedSubAgentBranchByThread(prev => {
      const next = new Map(prev);
      next.set(currentThreadId, branchId);
      return next;
    });
  }, [currentThreadId]);

  const openSubAgentBranch = useCallback((branchId: string) => {
    if (!currentThreadId) return;
    setSelectedSubAgentBranchByThread(prev => {
      const next = new Map(prev);
      next.set(currentThreadId, branchId);
      return next;
    });
    setSubAgentPanelOpenByThread(prev => {
      const next = new Map(prev);
      next.set(currentThreadId, true);
      return next;
    });
  }, [currentThreadId]);

  const closeSubAgentPanel = useCallback(() => {
    if (!currentThreadId) return;
    setSubAgentPanelOpenByThread(prev => {
      const next = new Map(prev);
      next.set(currentThreadId, false);
      return next;
    });
  }, [currentThreadId]);

  const resolveTaskBranchId = useCallback((toolCallId?: string): string | null => {
    if (!currentThreadId || !toolCallId) return null;
    const threadTaskMap = taskBranchMapByThread.get(currentThreadId);
    return threadTaskMap?.get(toolCallId) ?? null;
  }, [currentThreadId, taskBranchMapByThread]);

  const canOpenTaskBranch = useCallback((toolCallId?: string): boolean => {
    if (!currentThreadId || !toolCallId) return false;
    const mappedBranchId = taskBranchMapByThread.get(currentThreadId)?.get(toolCallId);
    if (!mappedBranchId) return false;
    const availableBranches = availableBranchByThread.get(currentThreadId);
    return Boolean(availableBranches?.has(mappedBranchId));
  }, [availableBranchByThread, currentThreadId, taskBranchMapByThread]);

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
        setRunningThreads,
        loadedThreads,
        setLoadedThreads,
        setTaskBranchMapByThread,
        setAvailableBranchByThread,
        isSubAgentPanelOpen,
        setSubAgentPanelOpen,
        selectedSubAgentBranchId,
        setSelectedSubAgentBranchId,
        openSubAgentBranch,
        closeSubAgentPanel,
        resolveTaskBranchId,
        canOpenTaskBranch,
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
    setRunningThreads,
    setLoadedThreads,
    setAvailableBranchByThread,
    setTaskBranchMapByThread,
    openSubAgentBranch,
  } = useThreadContext();

  const { serviceInfo } = useServiceInfo();
  const { incrementCount, onMessageStart, onMessageComplete } = useRateLimit();
  const isMobile = useIsMobile();
  const streamedToolResultsRef = useRef<Map<string, ReadonlyJSONValue>>(new Map());
  // Tracks task tool_call IDs already auto-opened for the current user turn.
  // This prevents repeated branch-map events for the same tool call from flipping selection.
  const autoOpenedTaskToolCallsRef = useRef<Set<string>>(new Set());

  const applyStreamedToolResults = useCallback((message: ChatMessage): ChatMessage => {
    if (!message.toolCalls?.length) return message;
    let changed = false;
    const toolCalls = message.toolCalls.map(toolCall => {
      if (toolCall.result !== undefined) return toolCall;
      const cachedResult = streamedToolResultsRef.current.get(toolCall.id);
      if (cachedResult === undefined) return toolCall;
      changed = true;
      return { ...toolCall, result: cachedResult };
    });
    return changed ? { ...message, toolCalls } : message;
  }, []);

  const {
    userData,
    createNewThread,
    switchToThread,
    updateThreadTitle,
    updateThreadActivity,
    deleteThread,
    activeThreads
  } = useUser();

  // Check if current thread is running
  const isRunning = currentThreadId ? runningThreads.has(currentThreadId) : false;

  // Get all messages for current thread
  const allCurrentMessages = useMemo(
    () => currentThreadId ? threads.get(currentThreadId) || [] : [],
    [currentThreadId, threads]
  );

  // Main thread shows only root-branch messages. Sub-agent branches render in the side panel.
  const currentMessages = useMemo(
    () => allCurrentMessages.filter((message) => (message.branchId || ROOT_BRANCH_ID) === ROOT_BRANCH_ID),
    [allCurrentMessages]
  );

  // Convert user threads to thread list format with loading state
  const threadList = activeThreads.map(thread => ({
    threadId: thread.id,
    status: "regular" as const,
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
    streamedToolResultsRef.current = new Map();
    autoOpenedTaskToolCallsRef.current = new Set();

    // Add user message optimistically
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessageText,
      timestamp: Date.now(),
    };

    setThreads(prev => {
      const existing = prev.get(currentThreadId) || [];
      return new Map(prev).set(currentThreadId, [...existing, userMessage]);
    });
    setRunningThreads(prev => new Set(prev).add(currentThreadId));

    // Update rate limit count immediately (optimistic update)
    incrementCount();

    // Notify rate limit provider that a message is starting
    onMessageStart();

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
      const messageTokenBuffers = new Map<string, string>();
      const streamRequest = {
        message: userMessageText,
        threadId: currentThreadId,
        userId: userId,
        agentId: selectedAgentId || serviceInfo?.default_agent,
        model: selectedModelId || serviceInfo?.default_model,
      };

      for await (const eventData of apiClient.streamMessage(streamRequest)) {
        const event = eventData as StreamEvent;
        const normalizedBranchId = normalizeBranchId(event.branchId);
        if (event.type === 'task_branch_map') {
          const mapping = event.content as TaskBranchMapContent;
          const mappedBranchId = normalizeBranchId(mapping.branchId);
          if (mappedBranchId === ROOT_BRANCH_ID || !mapping.toolCallId) {
            continue;
          }
          if (DEBUG_TASK_BRANCH_MAP) {
            console.log(`[task-branch-map] client toolCallId=${mapping.toolCallId} branchId=${mappedBranchId}`);
          }
          setTaskBranchMapByThread(prev => {
            const next = new Map(prev);
            const threadTaskMap = new Map(next.get(currentThreadId) ?? []);
            threadTaskMap.set(mapping.toolCallId, mappedBranchId);
            next.set(currentThreadId, threadTaskMap);
            return next;
          });
          const hasAutoOpenedForToolCall = autoOpenedTaskToolCallsRef.current.has(mapping.toolCallId);
          if (!hasAutoOpenedForToolCall) {
            autoOpenedTaskToolCallsRef.current.add(mapping.toolCallId);
            const isSmallViewport = typeof window !== "undefined"
              ? window.innerWidth < 768
              : isMobile;
            if (!isSmallViewport) {
              openSubAgentBranch(mappedBranchId);
            }
          }
          continue;
        }

        if (normalizedBranchId !== ROOT_BRANCH_ID) {
          setAvailableBranchByThread(prev => {
            const next = new Map(prev);
            const threadBranches = new Set(next.get(currentThreadId) ?? []);
            threadBranches.add(normalizedBranchId);
            next.set(currentThreadId, threadBranches);
            return next;
          });
        }

        if (event.type === 'token') {
          const messageId = event.messageId;
          const token = typeof event.content === "string" ? event.content : "";
          if (!messageId) {
            continue;
          }

          const previousByMessage = messageTokenBuffers.get(messageId) ?? "";
          const nextByMessage = previousByMessage + token;
          messageTokenBuffers.set(messageId, nextByMessage);

          // Upsert the specific message being streamed.
          setThreads(prev => {
            return updateThreadMessages(prev, currentThreadId, (messages) =>
              upsertTokenMessage(messages, {
                messageId,
                content: nextByMessage,
                branchId: normalizedBranchId,
                branchLabel: event.branchLabel,
              })
            );
          });
        } else if (event.type === 'reasoning') {
          const messageId = event.messageId;
          const reasoningChunk = typeof event.content === "string" ? event.content : "";
          if (!messageId || reasoningChunk === "") {
            continue;
          }

          setThreads(prev => {
            return updateThreadMessages(prev, currentThreadId, (messages) =>
              upsertReasoningMessage(messages, {
                messageId,
                reasoningChunk,
                branchId: normalizedBranchId,
                branchLabel: event.branchLabel,
              })
            );
          });
        } else if (event.type === 'message') {
          // Handle complete message (assistant text messages and custom messages)
          const messageData = event.content;

          // Check if this is a custom message (task update)
          if (isBackendCustomMessage(messageData) && messageData.custom_data) {
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
              branchId: normalizedBranchId,
              branchLabel: event.branchLabel,
              timestamp: Date.now(),
              customData: { taskData }
            };

            setThreads(prev => {
              return updateThreadMessages(prev, currentThreadId, (messages) =>
                upsertTaskMessage(messages, taskMessage)
              );
            });

            continue; // Continue processing the stream
          }

          if (!isChatMessagePayload(messageData)) {
            continue;
          }
          const message: ChatMessage = {
            ...messageData,
            branchId: normalizedBranchId || messageData.branchId,
            branchLabel: event.branchLabel || messageData.branchLabel,
          };
          const messageWithCachedResults = applyStreamedToolResults(message);
          const isMeaningfulAssistantMessage = !(
            messageWithCachedResults.role === "assistant"
            && messageWithCachedResults.content.trim() === ""
            && (!messageWithCachedResults.reasoningContent || messageWithCachedResults.reasoningContent.length === 0)
            && (!messageWithCachedResults.toolCalls || messageWithCachedResults.toolCalls.length === 0)
            && !messageWithCachedResults.customData
          );
          if (!isMeaningfulAssistantMessage) {
            continue;
          }

          // Keep local incremental buffers aligned with authoritative message payloads.
          if (typeof messageWithCachedResults.content === "string") {
            messageTokenBuffers.set(messageWithCachedResults.id, messageWithCachedResults.content);
          }

          setThreads(prev => {
            return updateThreadMessages(prev, currentThreadId, (messages) =>
              upsertAuthoritativeMessage(messages, messageWithCachedResults)
            );
          });

          // Update thread activity with assistant's response
          if (messageWithCachedResults.content && messageWithCachedResults.role === 'assistant') {
            updateThreadActivity(currentThreadId, messageWithCachedResults.content.substring(0, 50) + (messageWithCachedResults.content.length > 50 ? '...' : ''));
          }
        } else if (event.type === 'tool_call') {
          // Handle tool call - attach to streaming assistant message when available.
          const messageId = event.messageId;
          const toolCall = event.content as {
            id: string;
            name: string;
            args: ReadonlyJSONObject;
            batchId?: string;
          };
          if (!toolCall?.id || !toolCall?.name) {
            continue;
          }
          const cachedResult = streamedToolResultsRef.current.get(toolCall.id);

          setThreads(prev => {
            const targetMessageId = messageId || `tool-${toolCall.id}`;
            return updateThreadMessages(prev, currentThreadId, (messages) =>
              upsertToolCall(messages, {
                targetMessageId,
                toolCall: {
                  ...toolCall,
                  args: toolCall.args as ReadonlyJSONObject,
                  result: cachedResult,
                },
                branchId: normalizedBranchId,
                branchLabel: event.branchLabel,
              })
            );
          });
        } else if (event.type === 'tool_result') {
          // Handle tool result - update whichever assistant message owns this tool call.
          const result = event.content as { toolCallId: string; result: ReadonlyJSONValue };
          if (!result?.toolCallId) {
            continue;
          }
          const messageId = event.messageId;
          streamedToolResultsRef.current.set(result.toolCallId, result.result as ReadonlyJSONValue);

          setThreads(prev => {
            return updateThreadMessages(prev, currentThreadId, (messages) =>
              upsertToolResult(messages, {
                targetMessageId: messageId || `tool-${result.toolCallId}`,
                toolCallId: result.toolCallId,
                result: result.result as ReadonlyJSONValue,
                branchId: normalizedBranchId,
                branchLabel: event.branchLabel,
              })
            );
          });
        } else if (event.type === 'error') {
          console.error('Stream error:', event.content);
          setThreads(prev => {
            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${event.content}`,
              timestamp: Date.now(),
            };
            return updateThreadMessages(prev, currentThreadId, (messages) => [...messages, errorMessage]);
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
        return updateThreadMessages(prev, currentThreadId, (messages) => [...messages, errorMessage]);
      });
    } finally {
      setRunningThreads(prev => {
        const next = new Set(prev);
        next.delete(currentThreadId);
        return next;
      });

      // Notify rate limit provider that the message is complete
      onMessageComplete();
    }
  }, [currentThreadId, currentMessages, userId, selectedAgentId, selectedModelId, serviceInfo, setThreads, setRunningThreads, updateThreadActivity, updateThreadTitle, userData, incrementCount, onMessageStart, onMessageComplete, setAvailableBranchByThread, setTaskBranchMapByThread, applyStreamedToolResults, openSubAgentBranch, isMobile]);

  const threadListAdapter: ExternalStoreThreadListAdapter = {
    threadId: currentThreadId || '',
    threads: threadList,
    archivedThreads: [],
    onSwitchToNewThread: async () => {
      const defaultAgent = serviceInfo?.default_agent;
      const defaultModel = serviceInfo?.default_model;

      // Create the thread synchronously first to avoid race conditions
      const newThreadId = await createNewThread('New Chat', defaultAgent, defaultModel);
      if (newThreadId) {
        // Immediately set up the thread in our local state before any async operations
        // This prevents the skeleton from showing since the thread exists in the map
        setThreads(prev => new Map(prev).set(newThreadId, []));
        setLoadedThreads(prev => new Set(prev).add(newThreadId));
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
      // Replace archiving with deletion
      const result = await deleteThread(threadId);
      if (result) {
        // If deletion was successful, the user provider will handle switching to another thread
        // No additional action needed here
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
        setThreads(prev => {
          const existing = prev.get(currentThreadId) || [];
          const branchMessages = existing.filter(
            (message) => (message.branchId || ROOT_BRANCH_ID) !== ROOT_BRANCH_ID,
          );
          return new Map(prev).set(currentThreadId, [...messages.map(applyStreamedToolResults), ...branchMessages]);
        });
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
