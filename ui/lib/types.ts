// Backend API types matching your FastAPI service

export type ReadonlyJSONValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: ReadonlyJSONValue }
  | readonly ReadonlyJSONValue[];

export type ReadonlyJSONObject = { readonly [key: string]: ReadonlyJSONValue };
export const ROOT_BRANCH_ID = "root";

export interface TaskBranchMapContent {
  toolCallId: string;
  branchId: string;
}

export const isInternalBranchId = (branchId: string): boolean =>
  branchId.startsWith("__") || branchId.startsWith("branch:");

export const normalizeBranchId = (branchId?: string | null): string => {
  if (!branchId || !branchId.trim()) return ROOT_BRANCH_ID;
  const normalized = branchId.trim();
  return isInternalBranchId(normalized) ? ROOT_BRANCH_ID : normalized;
};

export type TaskData = {
  name: string;
  run_id: string;
  state: "new" | "running" | "complete";
  result?: "success" | "error" | null;
  data: Record<string, unknown>;
};

export const isTaskData = (value: unknown): value is TaskData => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TaskData>;
  return (
    typeof candidate.name === "string"
    && typeof candidate.run_id === "string"
    && (candidate.state === "new" || candidate.state === "running" || candidate.state === "complete")
    && typeof candidate.data === "object"
    && candidate.data !== null
  );
};

export interface BackendUserInput {
  message: string;
  model?: string;
  thread_id?: string;
  user_id?: string;
  agent_config?: ReadonlyJSONObject;
}

export interface BackendStreamInput extends BackendUserInput {
  stream_tokens?: boolean;
}

export interface BackendToolCall {
  name: string;
  args: ReadonlyJSONObject;
  id?: string;
  type?: "tool_call";
}

export interface BackendMessage {
  type: "human" | "ai" | "tool" | "custom";
  content: string;
  tool_calls?: BackendToolCall[];
  tool_call_id?: string;
  run_id?: string;
  response_metadata?: ReadonlyJSONObject;
  reasoning_content?: string[];
  custom_data?: ReadonlyJSONObject;
}

export interface BackendStreamEvent {
  type: 'message' | 'token' | 'reasoning' | 'error' | 'tool_call' | 'tool_result' | 'task_branch_map';
  content: string | BackendMessage | {
    id?: string;
    name?: string;
    args?: ReadonlyJSONObject;
    batchId?: string;
    toolCallId?: string;
    branchId?: string;
    result?: ReadonlyJSONValue;
  };
  messageId?: string; // For token events to identify which message they belong to
  message_id?: string;
  run_id?: string;
  branch_id?: string;
  branch_path?: string[];
  branch_label?: string;
  branchId?: string;
  branchLabel?: string;
}

// Rate limiting types
export interface RateLimitErrorResponse {
  error: 'Rate limit exceeded';
  details: {
    limit: number;
    currentCount: number;
    resetTime: string;
    remainingMessages: number;
  };
}

export interface BackendAgentInfo {
  key: string;
  description: string;
}

export interface BackendServiceMetadata {
  agents: BackendAgentInfo[];
  models: string[];
  default_agent: string;
  default_model: string;
}

export interface BackendChatHistory {
  messages: BackendMessage[];
}

// Frontend API types for Next.js API routes
export interface ChatRequest {
  message: string;
  threadId?: string;
  userId?: string;
  agentId?: string;
  model?: string;
  stream?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: ReadonlyJSONObject;
  result?: ReadonlyJSONValue;
  groupId?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string[];
  partOrder?: string[];
  branchId?: string;
  branchLabel?: string;
  timestamp: number;
  runId?: string;
  toolCalls?: ToolCall[];
  customData?: {
    taskData?: {
      name: string;
      run_id: string;
      state: "new" | "running" | "complete";
      result?: "success" | "error" | null;
      data: ReadonlyJSONObject;
    };
  };
}

export interface ThreadInfo {
  id: string;
  title: string;
  lastMessage?: string;
  timestamp: number;
  agentId?: string;
  modelId?: string;
}
