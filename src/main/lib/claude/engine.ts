/**
 * ClaudeEngine
 *
 * The composable core engine for running Claude Agent SDK.
 * Combines ConfigLoader, PromptBuilder, QueryBuilder, and Policies
 * to provide a unified interface for different scenarios.
 *
 * Features:
 * - Composable architecture with dependency injection
 * - Support for Chat, Automation, Insights, Worker scenarios
 * - Configuration override mechanism
 * - Prompt injection support
 * - Pluggable output channels
 * - Factory methods for common scenarios
 */
import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import type { AuthManager } from "../../auth-manager";
import { getBundledClaudeBinaryPath } from "./env";
import type { ClaudeConfigLoader} from "./config-loader";
import { getConfigLoader } from "./config-loader";
import type {
  PromptBuilder} from "./prompt-builder";
import {
  getPromptBuilder,
  ChatPromptStrategy,
  AutomationPromptStrategy,
  InsightsPromptStrategy,
  WorkerPromptStrategy,
} from "./prompt-builder";
import { createQueryBuilder } from "./sdk-query-builder";
import {
  createPolicy,
  createAutomationPolicy,
  AllowAllPolicy,
} from "./policies";
import { BufferChannel, CompositeChannel } from "./output-channel";
import type {
  EngineRequest,
  EngineEvent,
  ConfigOverride,
  PromptStrategy,
} from "./engine-types";

/**
 * ClaudeEngine - Core engine for running Claude Agent SDK
 */
export class ClaudeEngine {
  private configLoader: ClaudeConfigLoader;
  private promptBuilder: PromptBuilder;
  private claudeBinaryPath?: string;

  constructor(options?: {
    configLoader?: ClaudeConfigLoader;
    promptBuilder?: PromptBuilder;
    claudeBinaryPath?: string;
  }) {
    this.configLoader = options?.configLoader || getConfigLoader();
    this.promptBuilder = options?.promptBuilder || getPromptBuilder();
    this.claudeBinaryPath = options?.claudeBinaryPath;
  }

  /**
   * Set the Claude binary path
   */
  setClaudeBinaryPath(path: string): void {
    this.claudeBinaryPath = path;
  }

  /**
   * Run a Claude query with the given request
   *
   * @param request - Engine request configuration
   * @returns AsyncIterable of engine events
   */
  async *run(request: EngineRequest): AsyncIterable<EngineEvent> {
    // Load configuration with override support
    const config = await this.configLoader.getConfig(
      request.context,
      request.authManager,
      request.configOverride,
    );

    // Build system prompt
    const systemPrompt = await this.promptBuilder.buildSystemPrompt(
      request.promptStrategy,
      request.context.cwd,
    );

    // Build SDK query options
    const builder = createQueryBuilder()
      .setPrompt(request.prompt)
      .setSystemPrompt(systemPrompt)
      .setMcpServers(config.mcpServers)
      .setCwd(request.context.cwd)
      .setMode(request.mode || "agent");

    // Set Claude binary path
    const binaryPath = this.claudeBinaryPath || getBundledClaudeBinaryPath();
    if (binaryPath) {
      builder.setClaudeBinaryPath(binaryPath);
    }

    // Set model if provided
    if (request.model) {
      builder.setModel(request.model);
    }

    // Set agents if provided
    if (request.agents && Object.keys(request.agents).length > 0) {
      builder.setAgents(request.agents);
    }

    // Set session for resume
    if (request.sessionId) {
      builder.setSessionId(request.sessionId);
    }

    // Set tool permission policy
    if (request.policy) {
      builder.setToolPermissionPolicy(request.policy);
    }

    // Build query options
    const queryOptions = builder.build();

    // Run the query and yield events
    try {
      const stream = claudeQuery(queryOptions);

      let sessionId: string | undefined;
      const stats: Record<string, unknown> = {};

      for await (const message of stream) {
        // Extract session ID from messages
        if (message.session_id) {
          sessionId = message.session_id;
        }

        // Emit message to output channel
        if (request.outputChannel) {
          request.outputChannel.onMessage(message);
        }

        // Yield message event
        yield { type: "message", chunk: message } as EngineEvent;

        // Collect stats from result message
        if (message.type === "result") {
          Object.assign(stats, message);
        }
      }

      // Complete
      if (request.outputChannel?.onComplete) {
        request.outputChannel.onComplete({ sessionId, stats });
      }

      yield { type: "complete", sessionId, stats } as EngineEvent;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (request.outputChannel?.onError) {
        request.outputChannel.onError(err);
      }

      yield { type: "error", error: err } as EngineEvent;
    }
  }

  /**
   * Run a Claude query and return the final result (non-streaming)
   * Useful for automation and batch processing
   *
   * @param request - Engine request configuration
   * @returns Final result with text, session ID, and stats
   */
  async runToCompletion(request: EngineRequest): Promise<{
    text: string;
    sessionId?: string;
    stats?: Record<string, unknown>;
    errors: Error[];
  }> {
    const buffer = new BufferChannel();

    // Add buffer to existing output channel if present
    const outputChannel = request.outputChannel
      ? new CompositeChannel([request.outputChannel, buffer])
      : buffer;

    // Run the query
    for await (const _event of this.run({ ...request, outputChannel })) {
      // Events are processed by output channels
    }

    return {
      text: buffer.getFinalText(),
      sessionId: buffer.getResult()?.sessionId,
      stats: buffer.getResult()?.stats as Record<string, unknown> | undefined,
      errors: buffer.getErrors(),
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a ClaudeEngine for chat scenarios.
 * TODO: Inject chat-specific defaults (e.g. default configOverride, output channels)
 */
export function createChatEngine(): ClaudeEngine {
  return new ClaudeEngine();
}

/**
 * Create a ClaudeEngine for automation scenarios.
 * TODO: Inject automation-specific defaults (e.g. restricted MCP set, no plugins)
 */
export function createAutomationEngine(): ClaudeEngine {
  return new ClaudeEngine();
}

/**
 * Create a ClaudeEngine for insights generation.
 * TODO: Inject insights-specific defaults (e.g. no MCP tools, read-only)
 */
export function createInsightsEngine(): ClaudeEngine {
  return new ClaudeEngine();
}

/**
 * Create a ClaudeEngine for worker/background tasks.
 * TODO: Inject worker-specific defaults (e.g. configOverride, custom prompt strategy)
 */
export function createWorkerEngine(): ClaudeEngine {
  return new ClaudeEngine();
}

// ============================================================================
// Helper Types for Engine Requests
// ============================================================================

/**
 * Create a chat request
 */
export function createChatRequest(options: {
  prompt: string;
  cwd: string;
  userProfile?: { preferredName?: string; personalPreferences?: string };
  mode?: "plan" | "agent";
  sessionId?: string;
  model?: string;
  authManager?: AuthManager;
  isPlayground?: boolean;
  isOllama?: boolean;
}): EngineRequest {
  const strategy: PromptStrategy = {
    ...ChatPromptStrategy,
    userProfile: options.userProfile,
  };

  const policy = createPolicy({
    mode: options.mode || "agent",
    isPlayground: options.isPlayground || false,
    isOllama: options.isOllama || false,
  });

  return {
    prompt: options.prompt,
    promptStrategy: strategy,
    context: {
      cwd: options.cwd,
      includeBuiltin: true,
      includePlugins: true,
    },
    policy,
    authManager: options.authManager,
    sessionId: options.sessionId,
    model: options.model,
    mode: options.mode,
  };
}

/**
 * Create an automation request
 */
export function createAutomationRequest(options: {
  prompt: string;
  cwd: string;
  model?: string;
  authManager?: AuthManager;
  configOverride?: ConfigOverride;
}): EngineRequest {
  return {
    prompt: options.prompt,
    promptStrategy: AutomationPromptStrategy,
    context: {
      cwd: options.cwd,
      includeBuiltin: true,
      includePlugins: true,
    },
    configOverride: options.configOverride,
    policy: createAutomationPolicy(),
    authManager: options.authManager,
    model: options.model,
    mode: "agent",
  };
}

/**
 * Create an insights request
 */
export function createInsightsRequest(options: {
  prompt: string;
  cwd: string;
  model?: string;
  authManager?: AuthManager;
}): EngineRequest {
  return {
    prompt: options.prompt,
    promptStrategy: InsightsPromptStrategy,
    context: {
      cwd: options.cwd,
      includeBuiltin: false, // Insights don't need MCP tools
      includePlugins: false,
    },
    policy: new AllowAllPolicy(),
    authManager: options.authManager,
    model: options.model,
    mode: "agent",
  };
}

/**
 * Create a worker request
 */
export function createWorkerRequest(options: {
  prompt: string;
  cwd: string;
  model?: string;
  authManager?: AuthManager;
  configOverride?: ConfigOverride;
  customPromptStrategy?: PromptStrategy;
}): EngineRequest {
  return {
    prompt: options.prompt,
    promptStrategy: options.customPromptStrategy || WorkerPromptStrategy,
    context: {
      cwd: options.cwd,
      includeBuiltin: true,
      includePlugins: true,
    },
    configOverride: options.configOverride,
    policy: createAutomationPolicy(),
    authManager: options.authManager,
    model: options.model,
    mode: "agent",
  };
}

// ============================================================================
// Default Export
// ============================================================================

export default ClaudeEngine;
