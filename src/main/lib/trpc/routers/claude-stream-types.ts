/**
 * Type for Claude SDK streaming messages
 * These are the raw messages from the SDK query iterator
 */
export interface SdkStreamMessage {
  type?: string;
  subtype?: string;
  uuid?: string;
  mcp_servers?: unknown;
  error?: string | { message?: string };
  session_id?: string;
  cwd?: string;
  tools?: unknown;
  plugins?: unknown;
  permissionMode?: string;
  event?: {
    type?: string;
    delta?: { type?: string };
    content_block?: { type?: string };
  };
  message?: {
    id?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  [key: string]: unknown;
}

/**
 * Per-model usage breakdown for accurate token attribution
 */
export interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  costUSD?: number;
}

/**
 * Metadata accumulated during SDK streaming
 */
export interface StreamMetadata {
  sessionId?: string;
  sdkMessageUuid?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  modelUsage?: Record<string, ModelUsageEntry>;
  durationMs?: number;
}

/**
 * Input type for AskUserQuestion tool
 */
export interface AskUserQuestionInput {
  questions?: unknown[];
  [key: string]: unknown;
}

/**
 * Response type for tool permission callback
 */
export interface ToolPermissionResponse {
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown> & {
    answers?: Record<string, unknown>;
  };
  message?: string;
}
