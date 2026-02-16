/**
 * Langfuse Extension - TypeScript Type Definitions
 */

export interface LangfuseConfig {
  publicKey: string
  secretKey: string
  baseUrl?: string
  enabled: boolean
}

export interface TraceContext {
  traceId: string
  subChatId: string
  projectId: string
  mode: "plan" | "agent"
  prompts: string[]
  assistantTexts: string[]
  startTime: Date
}

export interface ToolCallContext {
  toolName: string
  input: unknown
  output: unknown
  startTime: Date
  endTime?: Date
  error?: string
}

export interface GenerationInput {
  traceId: string
  name: string
  model: string
  input: string[]
  output?: string
  usage?: {
    input: number
    output: number
    total: number
  }
  metadata?: Record<string, unknown>
  startTime: Date
  endTime?: Date
  level?: "DEFAULT" | "ERROR"
}

export interface SpanInput {
  traceId: string
  name: string
  input: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  startTime: Date
  endTime?: Date
  level?: "DEFAULT" | "ERROR"
}

export interface TruncatedOutput {
  _truncated: boolean
  _originalLength: number
  preview: string
}
