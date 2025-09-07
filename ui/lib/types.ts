// Backend API types matching your FastAPI service

export interface BackendUserInput {
  message: string;
  model?: string;
  thread_id?: string;
  user_id?: string;
  agent_config?: Record<string, unknown>;
}

export interface BackendStreamInput extends BackendUserInput {
  stream_tokens?: boolean;
}

export interface BackendToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
  type?: "tool_call";
}

export interface BackendMessage {
  type: "human" | "ai" | "tool" | "custom";
  content: string;
  tool_calls?: BackendToolCall[];
  tool_call_id?: string;
  run_id?: string;
  response_metadata?: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

export interface BackendStreamEvent {
  type: 'message' | 'token' | 'error' | 'tool_call' | 'tool_result';
  content: string | BackendMessage | {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
    toolCallId?: string;
    result?: unknown;
  };
  messageId?: string; // For token events to identify which message they belong to
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
  args: Record<string, unknown>;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  runId?: string;
  toolCalls?: ToolCall[];
  customData?: {
    taskData?: {
      name: string;
      run_id: string;
      state: "new" | "running" | "complete";
      result?: "success" | "error" | null;
      data: Record<string, any>;
    };
  };
}

export interface ThreadInfo {
  id: string;
  title: string;
  lastMessage?: string;
  timestamp: number;
  archived?: boolean;
  agentId?: string;
  modelId?: string;
}