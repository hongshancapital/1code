/**
 * Output Channel
 *
 * Defines the interface and implementations for Claude output handling.
 * Different scenarios can use different channels to direct output.
 *
 * Channels:
 * - ConsoleChannel: Logs to console (for debugging)
 * - CallbackChannel: Calls provided callback functions
 * - BufferChannel: Buffers all output for later retrieval
 * - CompositeChannel: Combines multiple channels
 */

import type { OutputChannel } from "./engine-types"
import { createLogger } from "../logger"

const log = createLogger("outputChannel")


// ============================================================================
// Channel Implementations
// ============================================================================

/**
 * Console channel - Logs to console (for debugging)
 */
export class ConsoleChannel implements OutputChannel {
  private prefix: string

  constructor(prefix = "[Claude]") {
    this.prefix = prefix
  }

  onMessage(chunk: unknown): void {
    log.info(`${this.prefix} Message:`, chunk)
  }

  onToolCall(toolName: string, input: unknown, output: unknown): void {
    log.info(`${this.prefix} Tool: ${toolName}`)
    log.info(`${this.prefix}   Input:`, input)
    log.info(`${this.prefix}   Output:`, output)
  }

  onError(error: Error): void {
    log.error(`${this.prefix} Error:`, error.message)
  }

  onComplete(result: { sessionId?: string; stats?: unknown }): void {
    log.info(`${this.prefix} Complete:`, result)
  }
}

/**
 * Callback channel - Calls provided callback functions
 */
export class CallbackChannel implements OutputChannel {
  private messageCallback?: (chunk: unknown) => void
  private toolCallback?: (toolName: string, input: unknown, output: unknown) => void
  private errorCallback?: (error: Error) => void
  private completeCallback?: (result: { sessionId?: string; stats?: unknown }) => void

  constructor(callbacks: {
    onMessage?: (chunk: unknown) => void
    onToolCall?: (toolName: string, input: unknown, output: unknown) => void
    onError?: (error: Error) => void
    onComplete?: (result: { sessionId?: string; stats?: unknown }) => void
  }) {
    this.messageCallback = callbacks.onMessage
    this.toolCallback = callbacks.onToolCall
    this.errorCallback = callbacks.onError
    this.completeCallback = callbacks.onComplete
  }

  onMessage(chunk: unknown): void {
    this.messageCallback?.(chunk)
  }

  onToolCall(toolName: string, input: unknown, output: unknown): void {
    this.toolCallback?.(toolName, input, output)
  }

  onError(error: Error): void {
    this.errorCallback?.(error)
  }

  onComplete(result: { sessionId?: string; stats?: unknown }): void {
    this.completeCallback?.(result)
  }
}

/**
 * Buffer channel - Buffers all output for later retrieval
 */
export class BufferChannel implements OutputChannel {
  private messages: unknown[] = []
  private toolCalls: Array<{ toolName: string; input: unknown; output: unknown }> = []
  private errors: Error[] = []
  private result?: { sessionId?: string; stats?: unknown }

  onMessage(chunk: unknown): void {
    this.messages.push(chunk)
  }

  onToolCall(toolName: string, input: unknown, output: unknown): void {
    this.toolCalls.push({ toolName, input, output })
  }

  onError(error: Error): void {
    this.errors.push(error)
  }

  onComplete(result: { sessionId?: string; stats?: unknown }): void {
    this.result = result
  }

  /**
   * Get all buffered messages
   */
  getMessages(): unknown[] {
    return [...this.messages]
  }

  /**
   * Get all buffered tool calls
   */
  getToolCalls(): Array<{ toolName: string; input: unknown; output: unknown }> {
    return [...this.toolCalls]
  }

  /**
   * Get all buffered errors
   */
  getErrors(): Error[] {
    return [...this.errors]
  }

  /**
   * Get the completion result
   */
  getResult(): { sessionId?: string; stats?: unknown } | undefined {
    return this.result
  }

  /**
   * Get the final text output (concatenated from text deltas)
   */
  getFinalText(): string {
    const textParts: string[] = []

    for (const msg of this.messages) {
      if (typeof msg === "object" && msg !== null) {
        const typed = msg as Record<string, unknown>
        if (typed.type === "text-delta" && typeof typed.delta === "string") {
          textParts.push(typed.delta)
        }
      }
    }

    return textParts.join("")
  }

  /**
   * Check if there were any errors
   */
  hasErrors(): boolean {
    return this.errors.length > 0
  }

  /**
   * Clear all buffered data
   */
  clear(): void {
    this.messages = []
    this.toolCalls = []
    this.errors = []
    this.result = undefined
  }
}

/**
 * Composite channel - Combines multiple channels
 */
export class CompositeChannel implements OutputChannel {
  private channels: OutputChannel[]

  constructor(channels: OutputChannel[]) {
    this.channels = channels
  }

  onMessage(chunk: unknown): void {
    for (const channel of this.channels) {
      channel.onMessage(chunk)
    }
  }

  onToolCall(toolName: string, input: unknown, output: unknown): void {
    for (const channel of this.channels) {
      channel.onToolCall?.(toolName, input, output)
    }
  }

  onError(error: Error): void {
    for (const channel of this.channels) {
      channel.onError?.(error)
    }
  }

  onComplete(result: { sessionId?: string; stats?: unknown }): void {
    for (const channel of this.channels) {
      channel.onComplete?.(result)
    }
  }

  /**
   * Add a channel
   */
  addChannel(channel: OutputChannel): void {
    this.channels.push(channel)
  }

  /**
   * Remove a channel
   */
  removeChannel(channel: OutputChannel): void {
    const index = this.channels.indexOf(channel)
    if (index !== -1) {
      this.channels.splice(index, 1)
    }
  }
}

/**
 * Null channel - Discards all output (useful for silent execution)
 */
export class NullChannel implements OutputChannel {
  onMessage(_chunk: unknown): void {
    // Discard
  }

  onToolCall(_toolName: string, _input: unknown, _output: unknown): void {
    // Discard
  }

  onError(_error: Error): void {
    // Discard
  }

  onComplete(_result: { sessionId?: string; stats?: unknown }): void {
    // Discard
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a console channel with optional prefix
 */
export function createConsoleChannel(prefix?: string): ConsoleChannel {
  return new ConsoleChannel(prefix)
}

/**
 * Create a callback channel
 */
export function createCallbackChannel(callbacks: {
  onMessage?: (chunk: unknown) => void
  onToolCall?: (toolName: string, input: unknown, output: unknown) => void
  onError?: (error: Error) => void
  onComplete?: (result: { sessionId?: string; stats?: unknown }) => void
}): CallbackChannel {
  return new CallbackChannel(callbacks)
}

/**
 * Create a buffer channel for collecting output
 */
export function createBufferChannel(): BufferChannel {
  return new BufferChannel()
}

/**
 * Create a composite channel from multiple channels
 */
export function createCompositeChannel(channels: OutputChannel[]): CompositeChannel {
  return new CompositeChannel(channels)
}

/**
 * Create a null channel (silent execution)
 */
export function createNullChannel(): NullChannel {
  return new NullChannel()
}
