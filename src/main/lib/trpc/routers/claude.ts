import { observable } from "@trpc/server/observable";
import { eq } from "drizzle-orm";
import { app, BrowserWindow } from "electron";
import * as fs from "fs/promises";
import * as os from "os";
import path from "path";
import { z } from "zod";
import {
  query as claudeQuery,
  type SDKUserMessage,
  type PermissionResult,
  type McpServerConfig as SdkMcpServerConfig,
  type SettingSource,
} from "@anthropic-ai/claude-agent-sdk";
import { PLAYGROUND_RELATIVE_PATH } from "../../../../shared/feature-config";
import {
  buildClaudeEnv,
  checkOfflineFallback,
  clearConfigCache,
  createTransformer,
  getBundledClaudeBinaryPath,
  getConfigLoader,
  getPromptBuilder,
  initializePromptBuilder,
  logClaudeEnv,
  logRawClaudeMessage,
  PLAN_MODE_BLOCKED_TOOLS,
  CHAT_MODE_BLOCKED_TOOLS,
  type UIMessageChunk,
} from "../../claude";
import { getEnv } from "../../env";
import {
  chats,
  getDatabase,
  subChats,
} from "../../db";
import { createRollbackStash } from "../../git/stash";
import {
  ensureMcpTokensFresh,
} from "../../mcp-auth";
import { publicProcedure, router } from "../index";
import { buildAgentsOption } from "./agent-utils";
import { fixOllamaToolParameters } from "./claude-ollama-fix";
import { computePreviewStatsFromMessages } from "./chat-helpers";
import { getAuthManager } from "../../../index";
import { getCachedRuntimeEnvironment } from "../../../feature/runner/router";
import { getHooks } from "../../extension";
import { ChatHook } from "../../extension/hooks/chat-lifecycle";
import { setLastUserMessageDebug } from "./debug";
import {
  parseMentions,
  shouldTrackAsArtifact,
  extractArtifactContexts,
} from "../../claude/mentions";
import {
  getClaudeCodeToken,
} from "../../claude/mcp-config";
import {
  mergeUnansweredMessages,
  buildImagePrompt,
  buildOllamaContext,
} from "../../claude/prompt-utils";
import { sanitizeMcpServerNames } from "../../claude/sdk-query-builder";
import { getMessages, appendMessage, replaceAllMessages } from "../../db/messages";
import { dbGetAsync, dbRunAsync, jsonParseAsync, jsonStringifyAsync } from "../../async-utils"
import { createLogger } from "../../logger"

const claudeLog = createLogger("claude")
const perfLog = createLogger("PERF")
const hookLog = createLogger("Hook")
const ollamaLog = createLogger("Ollama")
const sdLog = createLogger("SD")
const dbLog = createLogger("DB")



/**
 * Type for Claude SDK streaming messages
 * These are the raw messages from the SDK query iterator
 */
interface SdkStreamMessage {
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
interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  costUSD?: number;
}

/**
 * Metadata accumulated during SDK streaming
 */
interface StreamMetadata {
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
interface AskUserQuestionInput {
  questions?: unknown[];
  [key: string]: unknown;
}

/**
 * Response type for tool permission callback
 */
interface ToolPermissionResponse {
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown> & {
    answers?: Record<string, unknown>;
  };
  message?: string;
}


// Active sessions for cancellation (onAbort handles stash + abort + restore)
// Active sessions for cancellation
export const activeSessions = new Map<string, AbortController>();


// Cache for symlinks (track which subChatIds have already set up symlinks)
const symlinksCreated = new Set<string>();

export const pendingToolApprovals = new Map<
  string,
  {
    subChatId: string;
    resolve: (decision: {
      approved: boolean;
      message?: string;
      updatedInput?: unknown;
    }) => void;
  }
>();

// Initialize PromptBuilder with runtime environment provider (lazy init)
let promptBuilderInitialized = false;
function ensurePromptBuilderInitialized() {
  if (!promptBuilderInitialized) {
    initializePromptBuilder(async () => {
      const env = await getCachedRuntimeEnvironment();
      return {
        tools: env.tools.map((t) => ({
          category: t.category,
          name: t.name,
          version: t.version ?? undefined,
        })),
      };
    });
    promptBuilderInitialized = true;
  }
}

// PLAN_MODE_BLOCKED_TOOLS and CHAT_MODE_BLOCKED_TOOLS are imported from policies (single source of truth)

// Check if a cwd is the playground directory (for chat mode)
function isPlaygroundPath(cwd: string): boolean {
  const homePath = app.getPath("home");
  const playgroundPath = path.join(homePath, PLAYGROUND_RELATIVE_PATH);
  // Normalize paths for comparison (handle Windows path separators)
  const normalizedCwd = path.normalize(cwd).toLowerCase();
  const normalizedPlayground = path.normalize(playgroundPath).toLowerCase();
  return normalizedCwd.startsWith(normalizedPlayground);
}

export const clearPendingApprovals = (message: string, subChatId?: string) => {
  for (const [toolUseId, pending] of pendingToolApprovals) {
    if (subChatId && pending.subChatId !== subChatId) continue;
    pending.resolve({ approved: false, message });
    pendingToolApprovals.delete(toolUseId);
  }
};

// Image attachment schema
const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(), // e.g. "image/png", "image/jpeg"
  filename: z.string().optional(),
  localPath: z.string().optional(), // Original file path on disk
  tempPath: z.string().optional(), // Temp copy path (draft-attachments)
});

export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;

/**
 * Clear all performance caches (for testing/debugging)
 */
export function clearClaudeCaches() {
  symlinksCreated.clear();
  clearConfigCache(); // Clear ClaudeConfigLoader cache
  claudeLog.info("All caches cleared");
}

const _coreRouter = router({
  /**
   * Stream chat with Claude - single subscription handles everything
   */
  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        prompt: z.string(),
        cwd: z.string(),
        projectPath: z.string().optional(), // Original project path for MCP config lookup
        mode: z.enum(["plan", "agent"]).default("agent"),
        sessionId: z.string().optional(),
        model: z.string().optional(),
        customConfig: z
          .object({
            model: z.string().min(1),
            token: z.string(), // Can be empty for LiteLLM mode (uses env)
            baseUrl: z.string(), // Can be empty for LiteLLM mode (uses env)
          })
          .optional(),
        maxThinkingTokens: z.number().optional(), // Enable extended thinking
        images: z.array(imageAttachmentSchema).optional(), // Image attachments
        files: z
          .array(
            z.object({
              filename: z.string(),
              mediaType: z.string().optional(),
              size: z.number().optional(),
              localPath: z.string().optional(),
              tempPath: z.string().optional(),
            }),
          )
          .optional(), // Non-image file attachments (metadata only)
        historyEnabled: z.boolean().optional(),
        offlineModeEnabled: z.boolean().optional(), // Whether offline mode (Ollama) is enabled in settings
        askUserQuestionTimeout: z.number().optional(), // Timeout for AskUserQuestion in seconds (0 = no timeout)
        enableTasks: z.boolean().optional(), // Enable task management tools (TodoWrite, Task agents)
        disabledMcpServers: z.array(z.string()).optional(), // MCP servers to disable for this project
        userProfile: z
          .object({
            preferredName: z.string().max(50).optional(),
            personalPreferences: z.string().max(1000).optional(),
          })
          .optional(), // User personalization for AI recognition
        skillAwarenessEnabled: z.boolean().optional(), // Enable skill awareness prompt injection (default true)
        memoryEnabled: z.boolean().optional(), // Enable memory context injection (default true)
        memoryRecordingEnabled: z.boolean().optional(), // Enable memory recording (default true)
        summaryProviderId: z.string().optional(), // Summary model provider for LLM-enhanced memory
        summaryModelId: z.string().optional(), // Summary model ID for LLM-enhanced memory
        imageConfig: z
          .object({
            baseUrl: z.string(),
            apiKey: z.string(),
            model: z.string(),
          })
          .optional(), // Image generation API config (enables image-gen MCP tools)
      }),
    )
    .subscription(({ input }) => {
      return observable<UIMessageChunk>((emit) => {
        // Abort any existing session for this subChatId before starting a new one
        // This prevents race conditions if two messages are sent in quick succession
        const existingController = activeSessions.get(input.subChatId);
        if (existingController) {
          existingController.abort();
        }

        const abortController = new AbortController();
        const streamId = crypto.randomUUID();
        activeSessions.set(input.subChatId, abortController);

        // Stream debug logging
        const subId = input.subChatId.slice(-8); // Short ID for logs
        const streamStart = Date.now();
        let chunkCount = 0;
        let lastChunkType = "";
        // Shared state for cleanup closure to access
        let currentSessionId: string | null = null;
        let resolvedProjectId = "";
        claudeLog.info(
          `[SD] M:START sub=${subId} stream=${streamId.slice(-8)} mode=${input.mode} imageConfig=${input.imageConfig ? `model=${input.imageConfig.model} baseUrl=${input.imageConfig.baseUrl}` : "NOT SET"}`,
        );

        // Track if observable is still active (not unsubscribed)
        let isObservableActive = true;

        // Helper to safely emit (no-op if already unsubscribed)
        const safeEmit = (chunk: UIMessageChunk) => {
          if (!isObservableActive) return false;
          try {
            emit.next(chunk);
            return true;
          } catch {
            isObservableActive = false;
            return false;
          }
        };

        // Helper to safely complete (no-op if already closed)
        const safeComplete = () => {
          try {
            emit.complete();
          } catch {
            // Already completed or closed
          }
        };

        // Helper to emit error to frontend
        const emitError = (error: unknown, context: string) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;

          claudeLog.error(`${context}:`, errorMessage);
          if (errorStack) claudeLog.error("Stack:", errorStack);

          // Send detailed error to frontend (safely)
          safeEmit({
            type: "error",
            errorText: `${context}: ${errorMessage}`,
            // Include extra debug info
            ...(process.env.NODE_ENV !== "production" && {
              debugInfo: {
                context,
                cwd: input.cwd,
                mode: input.mode,
                PATH: process.env.PATH?.slice(0, 200),
              },
            }),
          } as UIMessageChunk);
        };

        (async () => {
          try {
            // Ensure PromptBuilder has runtime environment provider
            ensurePromptBuilderInitialized();

            const db = getDatabase();

            // 并行查询 subChat、messages、chat 三条独立记录
            const [existing, existingMessages, chatRecord] = await Promise.all([
              dbGetAsync(
                db
                  .select({ sessionId: subChats.sessionId })
                  .from(subChats)
                  .where(eq(subChats.id, input.subChatId))
              ),
              getMessages(input.subChatId),
              dbGetAsync(
                db
                  .select({ projectId: chats.projectId })
                  .from(chats)
                  .where(eq(chats.id, input.chatId))
              ),
            ]);
            const existingSessionId = existing?.sessionId || null;
            const projectId = chatRecord?.projectId;
            resolvedProjectId = projectId || "";

            // Get resumeSessionAt UUID only if shouldResume flag was set (by rollbackToMessage)
            const lastAssistantMsg = [...existingMessages]
              .reverse()
              .find((m: any) => m.role === "assistant");
            const resumeAtUuid = lastAssistantMsg?.metadata?.shouldResume
              ? lastAssistantMsg?.metadata?.sdkMessageUuid || null
              : null;
            const historyEnabled = input.historyEnabled === true;

            // Check if last message is already this user message (avoid duplicate)
            const lastMsg = existingMessages[existingMessages.length - 1];
            const lastMsgTextPart = lastMsg?.parts?.find(
              (p: any) => p.type === "text",
            );
            const isDuplicate =
              lastMsg?.role === "user" &&
              (lastMsgTextPart?.text === input.prompt ||
                lastMsg?.parts?.[0]?.text === input.prompt);

            // 2. Create user message and save BEFORE streaming (skip if duplicate)
            let userMessage: any;
            let messagesToSave: any[];

            if (isDuplicate) {
              userMessage = lastMsg;
              messagesToSave = existingMessages;
            } else {
              // Build complete user message parts (images, files, then text)
              const userParts: any[] = [];
              if (input.images && input.images.length > 0) {
                for (const img of input.images) {
                  // Store a displayable URL for reload (local-file:// or data URL)
                  // Don't store base64Data in DB to avoid bloat
                  const displayUrl = img.localPath
                    ? `local-file://${img.localPath}`
                    : img.tempPath
                      ? `local-file://${img.tempPath}`
                      : `data:${img.mediaType};base64,${img.base64Data}`;
                  userParts.push({
                    type: "data-image",
                    data: {
                      url: displayUrl,
                      mediaType: img.mediaType,
                      filename: img.filename,
                      localPath: img.localPath,
                      tempPath: img.tempPath,
                    },
                  });
                }
              }
              if (input.files && input.files.length > 0) {
                for (const f of input.files) {
                  userParts.push({
                    type: "data-file",
                    data: {
                      filename: f.filename,
                      mediaType: f.mediaType,
                      size: f.size,
                      localPath: f.localPath,
                      tempPath: f.tempPath,
                    },
                  });
                }
              }
              userParts.push({ type: "text", text: input.prompt });

              userMessage = {
                id: crypto.randomUUID(),
                role: "user",
                parts: userParts,
                createdAt: new Date().toISOString(),
              };
              messagesToSave = [...existingMessages, userMessage];

              // 异步化数据库写入和 JSON 序列化
              const messagesJson = await jsonStringifyAsync(messagesToSave);
              await dbRunAsync(
                db.update(subChats)
                  .set({
                    messages: messagesJson,
                    streamId,
                    updatedAt: new Date(),
                  })
                  .where(eq(subChats.id, input.subChatId))
              );
            }

            // === PERF TIMING: Track each phase to diagnose first-message delay ===
            const perfStart = Date.now();
            const perf = (label: string) => {
              const elapsed = Date.now() - perfStart;
              perfLog.info(`+${elapsed}ms  ${label}`);
            };
            perf("Start message pipeline");

            // 2.4. Memory hooks: Start session and record user prompt (via Extension Hook)
            const promptNumber =
              existingMessages.filter((m: any) => m.role === "user").length + 1;
            await getHooks().call(ChatHook.SessionStart, {
              subChatId: input.subChatId,
              chatId: input.chatId,
              projectId: projectId || "",
              cwd: input.cwd,
              mode: input.mode as "plan" | "agent",
              prompt: input.prompt,
              promptNumber,
              isResume: !!input.sessionId,
              sessionId: input.sessionId,
              memoryRecordingEnabled: input.memoryRecordingEnabled,
              summaryProviderId: input.summaryProviderId,
              summaryModelId: input.summaryModelId,
            });
            perf("chat:sessionStart hook done");

            // 2.4b. Notify user prompt received (fire-and-forget)
            getHooks()
              .call(ChatHook.UserPrompt, {
                sessionId: input.sessionId || null,
                subChatId: input.subChatId,
                projectId: projectId || "",
                prompt: input.prompt,
                promptNumber,
              })
              .catch((err) =>
                hookLog.error("chat:userPrompt error:", err),
              );

            // 2.5. Resolve custom config - handle LiteLLM mode (empty token/baseUrl means use env)
            let resolvedCustomConfig = input.customConfig;
            let isUsingLitellm = false;
            if (
              input.customConfig &&
              !input.customConfig.token &&
              !input.customConfig.baseUrl &&
              input.customConfig.model
            ) {
              // LiteLLM mode: populate from env
              isUsingLitellm = true;
              const env = getEnv();
              const litellmBaseUrl = env.MAIN_VITE_LITELLM_BASE_URL;
              const litellmApiKey = env.MAIN_VITE_LITELLM_API_KEY;

              if (litellmBaseUrl) {
                resolvedCustomConfig = {
                  model: input.customConfig.model,
                  token: litellmApiKey || "litellm",
                  baseUrl: litellmBaseUrl.replace(/\/+$/, ""),
                };
                claudeLog.info(
                  `[SD] Using LiteLLM mode: model=${input.customConfig.model} baseUrl=${litellmBaseUrl}`,
                );
              } else {
                // LiteLLM not configured, fall back to no custom config
                claudeLog.info(
                  `[SD] LiteLLM mode requested but MAIN_VITE_LITELLM_BASE_URL not configured`,
                );
                resolvedCustomConfig = undefined;
              }
            }

            // 2.6. AUTO-FALLBACK: Check internet and switch to Ollama if offline
            // Only check if offline mode is enabled in settings
            perf("checkOfflineFallback start");
            const claudeCodeToken = getClaudeCodeToken();
            const offlineResult = await checkOfflineFallback(
              resolvedCustomConfig,
              claudeCodeToken,
              undefined, // selectedOllamaModel - will be read from customConfig if present
              input.offlineModeEnabled ?? false, // Pass offline mode setting
            );

            perf("checkOfflineFallback done");
            perf("phase3: createTransformer start");

            if (offlineResult.error) {
              emitError(
                new Error(offlineResult.error),
                "Offline mode unavailable",
              );
              safeEmit({ type: "finish" } as UIMessageChunk);
              safeComplete();
              return;
            }

            // Use offline config if available
            const finalCustomConfig =
              offlineResult.config || resolvedCustomConfig;
            const isUsingOllama = offlineResult.isUsingOllama;

            // Offline status is shown in sidebar, no need to emit message here
            // (emitting text-delta without text-start breaks UI text rendering)

            const transform = createTransformer({
              emitSdkMessageUuid: historyEnabled,
              isUsingOllama,
            });
            perf("phase3: createTransformer done");

            // 4. Setup accumulation state
            const parts: any[] = [];
            let currentText = "";
            let metadata: StreamMetadata = {};

            // Capture stderr from Claude process for debugging
            const stderrLines: string[] = [];

            // FIX: Merge previous unanswered user messages to prevent context loss on interruption
            // Merge previous unanswered user messages to prevent context loss on interruption
            perf("phase3: mergeUnanswered start");
            const effectivePrompt = mergeUnansweredMessages(existingMessages, input.prompt);

            // Parse mentions from prompt (agents, skills, files, folders)
            const { cleanedPrompt, agentMentions, skillMentions } =
              parseMentions(effectivePrompt);
            perf("phase3: parseMentions done");

            // Build agents option for SDK (proper registration via options.agents)
            const agentsOption = await buildAgentsOption(
              agentMentions,
              input.cwd,
            );
            perf("phase3: buildAgentsOption done");

            // Log if agents were mentioned
            if (agentMentions.length > 0) {
              claudeLog.info(
                `[claude] Registering agents via SDK:`,
                Object.keys(agentsOption),
              );
            }

            // Log if skills were mentioned
            if (skillMentions.length > 0) {
              claudeLog.info(`Skills mentioned:`, skillMentions);
            }

            // Build final prompt with skill instructions if needed
            let finalPrompt = cleanedPrompt;

            // Handle empty prompt when only mentions are present
            if (!finalPrompt.trim()) {
              if (agentMentions.length > 0 && skillMentions.length > 0) {
                finalPrompt = `Use the ${agentMentions.join(", ")} agent(s) and invoke the "${skillMentions.join('", "')}" skill(s) using the Skill tool for this task.`;
              } else if (agentMentions.length > 0) {
                finalPrompt = `Use the ${agentMentions.join(", ")} agent(s) for this task.`;
              } else if (skillMentions.length > 0) {
                finalPrompt = `Invoke the "${skillMentions.join('", "')}" skill(s) using the Skill tool for this task.`;
              }
            } else if (skillMentions.length > 0) {
              // Append skill instruction to existing prompt
              finalPrompt = `${finalPrompt}\n\nUse the "${skillMentions.join('", "')}" skill(s) for this task.`;
            }

            // Build prompt: if there are images, create an AsyncIterable<SDKUserMessage>
            // Otherwise use simple string prompt
            perf("phase3: buildImagePrompt start");
            const imagePrompt = await buildImagePrompt(
              input.images || [],
              finalPrompt,
              input.cwd,
            );
            const prompt: string | AsyncIterable<SDKUserMessage> = imagePrompt || finalPrompt;
            perf("phase3: buildImagePrompt done");

            // Build full environment for Claude SDK (includes HOME, PATH, etc.)
            perf("phase3: buildClaudeEnv start");
            const claudeEnv = buildClaudeEnv({
              ...(finalCustomConfig && {
                customEnv: {
                  ANTHROPIC_AUTH_TOKEN: finalCustomConfig.token,
                  ANTHROPIC_BASE_URL: finalCustomConfig.baseUrl,
                },
              }),
              enableTasks: input.enableTasks ?? true,
            });
            perf("phase3: buildClaudeEnv done");

            // Debug logging in dev
            if (process.env.NODE_ENV !== "production") {
              logClaudeEnv(claudeEnv, `[${input.subChatId}] `);
            }

            // Create isolated config directory per subChat to prevent session contamination
            // The Claude binary stores sessions in ~/.claude/ based on cwd, which causes
            // cross-chat contamination when multiple chats use the same project folder
            // For Ollama: use chatId instead of subChatId so all messages in the same chat share history
            const isolatedConfigDir = path.join(
              app.getPath("userData"),
              "claude-sessions",
              isUsingOllama ? input.chatId : input.subChatId,
            );

            // MCP servers to pass to SDK - loaded via ClaudeConfigLoader
            let mcpServersForSdk: Record<string, any> | undefined;

            // Ensure isolated config dir exists and symlink skills/agents from ~/.claude/
            // This is needed because SDK looks for skills at $CLAUDE_CONFIG_DIR/skills/
            // OPTIMIZATION: Only create symlinks once per subChatId (cached)
            try {
              perf("phase3: mkdir+symlinks start");
              await fs.mkdir(isolatedConfigDir, { recursive: true });

              // Only create symlinks if not already created for this config dir
              const cacheKey = isUsingOllama ? input.chatId : input.subChatId;
              if (!symlinksCreated.has(cacheKey)) {
                const homeClaudeDir = path.join(os.homedir(), ".claude");
                const skillsSource = path.join(homeClaudeDir, "skills");
                const skillsTarget = path.join(isolatedConfigDir, "skills");
                const agentsSource = path.join(homeClaudeDir, "agents");
                const agentsTarget = path.join(isolatedConfigDir, "agents");

                // 并行检查所有目录状态
                const [skillsSourceExists, skillsTargetExists, agentsSourceExists, agentsTargetExists] = await Promise.all([
                  fs.stat(skillsSource).then(() => true).catch(() => false),
                  fs.lstat(skillsTarget).then(() => true).catch(() => false),
                  fs.stat(agentsSource).then(() => true).catch(() => false),
                  fs.lstat(agentsTarget).then(() => true).catch(() => false),
                ]);

                // 并行创建符号链接
                const symlinkTasks: Promise<void>[] = [];
                if (skillsSourceExists && !skillsTargetExists) {
                  symlinkTasks.push(fs.symlink(skillsSource, skillsTarget, "dir").catch(() => {}));
                }
                if (agentsSourceExists && !agentsTargetExists) {
                  symlinkTasks.push(fs.symlink(agentsSource, agentsTarget, "dir").catch(() => {}));
                }
                if (symlinkTasks.length > 0) await Promise.all(symlinkTasks);

                symlinksCreated.add(cacheKey);
              }

              // Load MCP servers via ClaudeConfigLoader (unified configuration)
              try {
                perf("configLoader.getConfig start (includes MCP warmup wait)");
                const configLoader = getConfigLoader();
                const authManager = getAuthManager();
                const loadedConfig = await configLoader.getConfig(
                  {
                    cwd: input.projectPath || input.cwd,
                    projectPath: input.projectPath,
                    includeBuiltin: true,
                    includePlugins: true,
                    filterNonWorking: true,
                    disabledMcpServers: input.disabledMcpServers,
                  },
                  authManager,
                );

                perf(`configLoader.getConfig done (${Object.keys(loadedConfig.mcpServers).length} servers)`);
                if (Object.keys(loadedConfig.mcpServers).length > 0) {
                  mcpServersForSdk = loadedConfig.mcpServers;
                }
              } catch (configErr) {
                claudeLog.error(
                  `[claude] Failed to load MCP config via ClaudeConfigLoader:`,
                  configErr,
                );
              }
            } catch (mkdirErr) {
              claudeLog.error(
                `[claude] Failed to setup isolated config dir:`,
                mkdirErr,
              );
            }

            // Check if user has existing API key or proxy configured in their shell environment
            // If so, use that instead of OAuth (allows using custom API proxies)
            // Based on PR #29 by @sa4hnd
            const hasExistingApiConfig = !!(
              claudeEnv.ANTHROPIC_API_KEY || claudeEnv.ANTHROPIC_BASE_URL
            );

            if (hasExistingApiConfig) {
              claudeLog.info(
                `[claude] Using existing CLI config - API_KEY: ${claudeEnv.ANTHROPIC_API_KEY ? "set" : "not set"}, BASE_URL: ${claudeEnv.ANTHROPIC_BASE_URL || "default"}`,
              );
            }

            // Build final env - only add OAuth token if we have one AND no existing API config
            // Existing CLI config takes precedence over OAuth
            const finalEnv: Record<string, string | undefined> = {
              ...claudeEnv,
              ...(claudeCodeToken &&
                !hasExistingApiConfig && {
                  CLAUDE_CODE_OAUTH_TOKEN: claudeCodeToken,
                }),
              // Re-enable CLAUDE_CONFIG_DIR now that we properly map MCP configs
              CLAUDE_CONFIG_DIR: isolatedConfigDir,
            };

            // Get bundled Claude binary path
            const claudeBinaryPath = getBundledClaudeBinaryPath();

            let resumeSessionId =
              input.sessionId || existingSessionId || undefined;

            // DEBUG: Session resume path tracing
            const expectedSanitizedCwd = input.cwd.replace(/[/.]/g, "-");
            const expectedSessionPath = resumeSessionId
              ? path.join(
                  isolatedConfigDir,
                  "projects",
                  expectedSanitizedCwd,
                  `${resumeSessionId}.jsonl`,
                )
              : null;

            // If session file doesn't exist (e.g. CWD changed after migrate),
            // skip resume to avoid SDK crash with exit code 1
            if (resumeSessionId && expectedSessionPath) {
              // 异步检查文件存在性,避免阻塞主进程
              const sessionExists = await fs.access(expectedSessionPath)
                .then(() => true)
                .catch(() => false);

              if (!sessionExists) {
                claudeLog.info(
                  `[claude] Session file not found at ${expectedSessionPath}, skipping resume`,
                );
                resumeSessionId = undefined;
                // Also clear stale sessionId from DB (异步化)
                await dbRunAsync(
                  db.update(subChats)
                    .set({ sessionId: null })
                    .where(eq(subChats.id, input.subChatId))
                );
              }
            }
            claudeLog.info(`========== SESSION DEBUG ==========`);
            claudeLog.info(`subChatId: ${input.subChatId}`);
            claudeLog.info(`cwd: ${input.cwd}`);
            claudeLog.info(
              `[claude] sanitized cwd (expected): ${expectedSanitizedCwd}`,
            );
            claudeLog.info(`CLAUDE_CONFIG_DIR: ${isolatedConfigDir}`);
            claudeLog.info(
              `[claude] Expected session path: ${expectedSessionPath}`,
            );
            claudeLog.info(`Session ID to resume: ${resumeSessionId}`);
            claudeLog.info(
              `[claude] Existing sessionId from DB: ${existingSessionId}`,
            );
            claudeLog.info(`Resume at UUID: ${resumeAtUuid}`);
            claudeLog.info(`========== END SESSION DEBUG ==========`);

            claudeLog.info(
              `[SD] Query options - cwd: ${input.cwd}, projectPath: ${input.projectPath || "(not set)"}, mcpServers: ${mcpServersForSdk ? Object.keys(mcpServersForSdk).join(", ") : "(none)"}`,
            );
            if (finalCustomConfig) {
              const redactedConfig = {
                ...finalCustomConfig,
                token: `${finalCustomConfig.token.slice(0, 6)}...`,
              };
              if (isUsingOllama) {
                claudeLog.info(
                  `[Ollama] Using offline mode - Model: ${finalCustomConfig.model}, Base URL: ${finalCustomConfig.baseUrl}`,
                );
              } else {
                claudeLog.info(
                  `[claude] Custom config: ${JSON.stringify(redactedConfig)}`,
                );
              }
            }

            const resolvedModel = finalCustomConfig?.model || input.model;

            // DEBUG: If using Ollama, test if it's actually responding
            if (isUsingOllama && finalCustomConfig) {
              claudeLog.info("[Ollama Debug] Testing Ollama connectivity...");
              try {
                const testResponse = await fetch(
                  `${finalCustomConfig.baseUrl}/api/tags`,
                  {
                    signal: AbortSignal.timeout(2000),
                  },
                );
                if (testResponse.ok) {
                  const data = await testResponse.json();
                  const models = data.models?.map((m: any) => m.name) || [];
                  claudeLog.info(
                    "[Ollama Debug] Ollama is responding. Available models:",
                    models,
                  );

                  if (!models.includes(finalCustomConfig.model)) {
                    claudeLog.error(
                      `[Ollama Debug] WARNING: Model "${finalCustomConfig.model}" not found in Ollama!`,
                    );
                    claudeLog.error(`[Ollama Debug] Available models:`, models);
                    claudeLog.error(
                      `[Ollama Debug] This will likely cause the stream to hang or fail silently.`,
                    );
                  } else {
                    claudeLog.info(
                      `[Ollama Debug] ✓ Model "${finalCustomConfig.model}" is available`,
                    );
                  }
                } else {
                  claudeLog.error(
                    "[Ollama Debug] Ollama returned error:",
                    testResponse.status,
                  );
                }
              } catch (err) {
                claudeLog.error(
                  "[Ollama Debug] Failed to connect to Ollama:",
                  err,
                );
              }
            }

            // Skip MCP servers entirely in offline mode (Ollama) - they slow down initialization by 60+ seconds
            // Otherwise ensure MCP tokens are fresh before passing to SDK
            let mcpServersFiltered: Record<string, any> | undefined;

            if (isUsingOllama) {
              claudeLog.info(
                "[Ollama] Skipping MCP servers to speed up initialization",
              );
              mcpServersFiltered = undefined;
            } else {
              // Refresh MCP tokens (disabled servers already filtered by ConfigLoader)
              perf("ensureMcpTokensFresh start");
              if (
                mcpServersForSdk &&
                Object.keys(mcpServersForSdk).length > 0
              ) {
                const lookupPath = input.projectPath || input.cwd;
                mcpServersFiltered = await ensureMcpTokensFresh(
                  mcpServersForSdk,
                  lookupPath,
                );
              } else {
                mcpServersFiltered = mcpServersForSdk;
              }
              perf("ensureMcpTokensFresh done");

              // Hook: collectMcpServers — Extensions inject their MCP servers
              perf("chat:collectMcpServers start");
              const collectedMcps = await getHooks().call(
                ChatHook.CollectMcpServers,
                {
                  cwd: input.cwd,
                  subChatId: input.subChatId,
                  projectId: projectId || "",
                  isOllama: isUsingOllama,
                  existingServers: mcpServersFiltered || {},
                  imageConfig: input.imageConfig,
                },
              );
              for (const entry of collectedMcps) {
                mcpServersFiltered = {
                  ...mcpServersFiltered,
                  [entry.name]: entry.config,
                };
              }
              perf(`chat:collectMcpServers done (${collectedMcps.length} injected)`);
              if (collectedMcps.length > 0) {
                claudeLog.info(
                  `[MCP] Extensions injected ${collectedMcps.length} server(s):`,
                  collectedMcps.map((e) => e.name).join(", "),
                );
              }
            }

            // Log SDK configuration for debugging
            if (isUsingOllama) {
              claudeLog.info("[Ollama Debug] SDK Configuration:", {
                model: resolvedModel,
                baseUrl: finalEnv.ANTHROPIC_BASE_URL,
                cwd: input.cwd,
                configDir: isolatedConfigDir,
                hasAuthToken: !!finalEnv.ANTHROPIC_AUTH_TOKEN,
                tokenPreview:
                  finalEnv.ANTHROPIC_AUTH_TOKEN?.slice(0, 10) + "...",
              });
              claudeLog.info("[Ollama Debug] Session settings:", {
                resumeSessionId: resumeSessionId || "none (first message)",
                mode: resumeSessionId ? "resume" : "continue",
                note: resumeSessionId
                  ? "Resuming existing session to maintain chat history"
                  : "Starting new session with continue mode",
              });
            }

            // Read AGENTS.md from project root if it exists
            let agentsMdContent: string | undefined;
            try {
              const agentsMdPath = path.join(input.cwd, "AGENTS.md");
              agentsMdContent = await fs.readFile(agentsMdPath, "utf-8");
              if (agentsMdContent.trim()) {
                claudeLog.info(
                  `[claude] Found AGENTS.md at ${agentsMdPath} (${agentsMdContent.length} chars)`,
                );
              } else {
                agentsMdContent = undefined;
              }
            } catch {
              // AGENTS.md doesn't exist or can't be read - that's fine
            }

            // For Ollama: embed context AND history directly in prompt
            let finalQueryPrompt: string | AsyncIterable<SDKUserMessage> = prompt;
            if (isUsingOllama && typeof prompt === "string") {
              finalQueryPrompt = await buildOllamaContext({
                existingMessages,
                prompt,
                cwd: input.cwd,
                projectPath: input.projectPath,
                resolvedModel,
                agentsMdContent,
                userProfile: input.userProfile,
                getCachedRuntimeEnvironment: async () => {
                  const env = await getCachedRuntimeEnvironment();
                  return {
                    tools: env.tools.map((t) => ({
                      category: t.category,
                      name: t.name,
                      version: t.version ?? undefined,
                    })),
                  };
                },
              });
            }

            // Build append sections via enhancePrompt waterfall hook
            // Memory context + Browser context are injected by their respective Extensions
            perf("chat:enhancePrompt start");
            const enhanced = await getHooks().call(ChatHook.EnhancePrompt, {
              appendSections: [],
              cwd: input.cwd,
              projectId: projectId || "",
              subChatId: input.subChatId,
              prompt: input.prompt,
              isOllama: isUsingOllama,
              memoryEnabled: input.memoryEnabled,
            });
            const appendSections = enhanced.appendSections;
            perf(`chat:enhancePrompt done (${appendSections.length} sections)`);

            // Build system prompt using PromptBuilder (composable architecture)
            perf("buildSystemPrompt start");
            const promptBuilder = getPromptBuilder();

            const systemPromptConfig = await promptBuilder.buildSystemPrompt(
              {
                type: "chat",
                includeSoftwareIntro: true,
                includeRuntimeInfo: true,
                includeSkillAwareness: input.skillAwarenessEnabled !== false,
                includeAgentsMd: true,
                userProfile: input.userProfile,
                ...(appendSections.length > 0 && { appendSections }),
              },
              input.cwd,
            );
            perf("buildSystemPrompt done");
            claudeLog.info(
              "[claude] systemPromptConfig append:",
              systemPromptConfig.append
                ? systemPromptConfig.append.slice(0, 200)
                : "none",
            );

            const queryOptions = {
              prompt: finalQueryPrompt,
              options: {
                abortController, // Must be inside options!
                cwd: input.cwd,
                systemPrompt: systemPromptConfig as { type: "preset"; preset: "claude_code"; append?: string },
                // Register mentioned agents with SDK via options.agents (skip for Ollama - not supported)
                ...(!isUsingOllama &&
                  Object.keys(agentsOption).length > 0 && {
                    agents: agentsOption as Record<string, { description: string; prompt: string; model?: string; tools?: string[] }>,
                  }),
                // Pass filtered MCP servers (only working/unknown ones, skip failed/needs-auth)
                // Sanitize server name keys (hyphens → underscores) for OpenAI function name compatibility
                ...(mcpServersFiltered &&
                  Object.keys(mcpServersFiltered).length > 0 && {
                    mcpServers: sanitizeMcpServerNames(mcpServersFiltered) as Record<string, SdkMcpServerConfig>,
                  }),
                env: finalEnv,
                permissionMode:
                  input.mode === "plan"
                    ? ("plan" as const)
                    : ("bypassPermissions" as const),
                ...(input.mode !== "plan" && {
                  allowDangerouslySkipPermissions: true,
                }),
                includePartialMessages: true,
                // Load skills from project and user directories (skip for Ollama - not supported)
                ...(!isUsingOllama && {
                  settingSources: ["project", "user"] as SettingSource[],
                }),
                canUseTool: async (
                  toolName: string,
                  toolInput: Record<string, unknown>,
                  options: { toolUseID: string },
                ): Promise<PermissionResult> => {
                  // Fix common parameter mistakes from Ollama models
                  if (isUsingOllama) {
                    fixOllamaToolParameters(toolName, toolInput);
                  }

                  // Chat mode (playground): block file tools, user should convert to cowork/coding mode
                  if (isPlaygroundPath(input.cwd)) {
                    if (CHAT_MODE_BLOCKED_TOOLS.has(toolName)) {
                      return {
                        behavior: "deny" as const,
                        message: `Tool "${toolName}" is not available in chat mode. To work with files, please convert this chat to a workspace (Cowork or Coding mode).`,
                      };
                    }
                  }

                  if (input.mode === "plan") {
                    if (toolName === "Edit" || toolName === "Write") {
                      const filePath =
                        typeof toolInput.file_path === "string"
                          ? toolInput.file_path
                          : "";
                      if (!/\.md$/i.test(filePath)) {
                        return {
                          behavior: "deny" as const,
                          message:
                            'Only ".md" files can be modified in plan mode.',
                        };
                      }
                    } else if (PLAN_MODE_BLOCKED_TOOLS.has(toolName)) {
                      return {
                        behavior: "deny" as const,
                        message: `Tool "${toolName}" blocked in plan mode.`,
                      };
                    }
                  }
                  if (toolName === "AskUserQuestion") {
                    const { toolUseID } = options;
                    const askInput = toolInput as AskUserQuestionInput;
                    // Emit to UI (safely in case observer is closed)
                    // Frontend will read the latest timeout setting from its store
                    safeEmit({
                      type: "ask-user-question",
                      toolUseId: toolUseID,
                      questions: askInput.questions,
                    } as UIMessageChunk);

                    // Backend uses a long safety timeout (10 minutes) as a fallback
                    // Frontend controls the actual timeout behavior based on user settings
                    const SAFETY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

                    // Wait for response (safety timeout protects against hung sessions)
                    const response = await new Promise<{
                      approved: boolean;
                      message?: string;
                      updatedInput?: unknown;
                    }>((resolve) => {
                      // Safety timeout - frontend handles actual user-configured timeout
                      const timeoutId = setTimeout(() => {
                        pendingToolApprovals.delete(toolUseID);
                        // Emit chunk to notify UI that the question has timed out
                        // This ensures the pending question dialog is cleared
                        safeEmit({
                          type: "ask-user-question-timeout",
                          toolUseId: toolUseID,
                        } as UIMessageChunk);
                        resolve({ approved: false, message: "Timed out" });
                      }, SAFETY_TIMEOUT_MS);

                      pendingToolApprovals.set(toolUseID, {
                        subChatId: input.subChatId,
                        resolve: (d) => {
                          if (timeoutId) clearTimeout(timeoutId);
                          resolve(d);
                        },
                      });
                    });

                    // Find the tool part in accumulated parts
                    const askToolPart = parts.find(
                      (p) =>
                        p.toolCallId === toolUseID &&
                        p.type === "tool-AskUserQuestion",
                    );

                    if (!response.approved) {
                      // Update the tool part with error result for skipped/denied
                      const errorMessage = response.message || "Skipped";
                      if (askToolPart) {
                        askToolPart.result = errorMessage;
                        askToolPart.state = "result";
                      }
                      // Emit result to frontend so it updates in real-time
                      safeEmit({
                        type: "ask-user-question-result",
                        toolUseId: toolUseID,
                        result: errorMessage,
                      } as unknown as UIMessageChunk);
                      return {
                        behavior: "deny" as const,
                        message: errorMessage,
                      };
                    }

                    // Update the tool part with answers result for approved
                    const answers = (
                      response.updatedInput as ToolPermissionResponse["updatedInput"]
                    )?.answers;
                    const answerResult = { answers };
                    if (askToolPart) {
                      askToolPart.result = answerResult;
                      askToolPart.state = "result";
                    }
                    // Emit result to frontend so it updates in real-time
                    safeEmit({
                      type: "ask-user-question-result",
                      toolUseId: toolUseID,
                      result: answerResult,
                    } as unknown as UIMessageChunk);
                    return {
                      behavior: "allow" as const,
                      updatedInput: response.updatedInput as
                        | Record<string, unknown>
                        | undefined,
                    };
                  }
                  return {
                    behavior: "allow" as const,
                    updatedInput: toolInput,
                  };
                },
                stderr: (data: string) => {
                  stderrLines.push(data);
                  if (isUsingOllama) {
                    claudeLog.error("[Ollama stderr]", data);
                  } else {
                    claudeLog.error("[claude stderr]", data);
                  }
                },
                // Use bundled binary
                pathToClaudeCodeExecutable: claudeBinaryPath,
                // Session handling: For Ollama, use resume with session ID to maintain history
                // For Claude API, use resume with rollback support
                ...(resumeSessionId && {
                  resume: resumeSessionId,
                  // Rollback support - resume at specific message UUID (from DB)
                  ...(resumeAtUuid && !isUsingOllama
                    ? { resumeSessionAt: resumeAtUuid }
                    : { continue: true }),
                }),
                // For first message in chat (no session ID yet), use continue mode
                ...(!resumeSessionId && { continue: true }),
                ...(resolvedModel && { model: resolvedModel }),
                // fallbackModel: "claude-opus-4-5-20251101",
                ...(input.maxThinkingTokens && {
                  maxThinkingTokens: input.maxThinkingTokens,
                }),
              },
            };

            // 5. Run Claude SDK
            perf("claudeQuery (SDK create) start");
            let stream;
            try {
              // Save debug data before sending to SDK
              setLastUserMessageDebug(input.subChatId, {
                // Request input
                input: {
                  subChatId: input.subChatId,
                  chatId: input.chatId,
                  prompt: input.prompt,
                  cwd: input.cwd,
                  projectPath: input.projectPath,
                  mode: input.mode,
                  sessionId: input.sessionId,
                  model: input.model,
                  customConfig: input.customConfig,
                  maxThinkingTokens: input.maxThinkingTokens,
                  images: input.images?.map((img) => ({
                    filename: img.filename,
                    mediaType: img.mediaType,
                  })),
                  files: input.files?.map((f) => ({
                    filename: f.filename,
                    mediaType: f.mediaType,
                    size: f.size,
                  })),
                  historyEnabled: input.historyEnabled,
                  offlineModeEnabled: input.offlineModeEnabled,
                  askUserQuestionTimeout: input.askUserQuestionTimeout,
                  enableTasks: input.enableTasks,
                  disabledMcpServers: input.disabledMcpServers,
                  userProfile: input.userProfile,
                  skillAwarenessEnabled: input.skillAwarenessEnabled,
                  memoryEnabled: input.memoryEnabled,
                  memoryRecordingEnabled: input.memoryRecordingEnabled,
                  summaryProviderId: input.summaryProviderId,
                  summaryModelId: input.summaryModelId,
                  imageConfig: input.imageConfig,
                },
                // Processed query options
                queryOptions: {
                  prompt: finalQueryPrompt,
                  systemPrompt: systemPromptConfig,
                  agents: agentsOption,
                  mcpServers: mcpServersFiltered
                    ? {
                        ...mcpServersFiltered,
                        // Only show keys to avoid large JSON
                        _keys: Object.keys(mcpServersFiltered),
                      }
                    : undefined,
                  env: finalEnv,
                  permissionMode:
                    input.mode === "plan" ? "plan" : "bypassPermissions",
                  allowDangerouslySkipPermissions: input.mode !== "plan",
                  includePartialMessages: true,
                  settingSources: ["project", "user"],
                },
                // Additional context
                isUsingOllama,
                isUsingLitellm,
                finalCustomConfig,
              });
              stream = claudeQuery(queryOptions as Parameters<typeof claudeQuery>[0]);
              perf("claudeQuery (SDK create) done — now waiting for first stream message");
            } catch (queryError) {
              claudeLog.error(
                "[CLAUDE] ✗ Failed to create SDK query:",
                queryError,
              );
              emitError(queryError, "Failed to start Claude query");
              claudeLog.info(
                `[SD] M:END sub=${subId} reason=query_error n=${chunkCount}`,
              );
              safeEmit({ type: "finish" } as UIMessageChunk);
              safeComplete();
              return;
            }

            let messageCount = 0;
            let firstMessageReceived = false;
            // Track last assistant message UUID for rollback support
            // Only assigned to metadata AFTER the stream completes (not during generation)
            let lastAssistantUuid: string | null = null;
            const streamIterationStart = Date.now();

            // Plan mode: track ExitPlanMode to stop after plan is complete
            let planCompleted = false;
            let exitPlanModeToolCallId: string | null = null;

            if (isUsingOllama) {
              ollamaLog.info(`===== STARTING STREAM ITERATION =====`);
              ollamaLog.info(`Model: ${finalCustomConfig?.model}`);
              ollamaLog.info(`Base URL: ${finalCustomConfig?.baseUrl}`);
              claudeLog.info(
                `[Ollama] Prompt: "${typeof input.prompt === "string" ? input.prompt.slice(0, 100) : "N/A"}..."`,
              );
              ollamaLog.info(`CWD: ${input.cwd}`);
            }

            try {
              for await (const msg of stream) {
                // For plan mode completion, we abort but still need to wait for the result message
                // to get token usage data. Only break immediately if it's not plan completion.
                if (abortController.signal.aborted && !planCompleted) {
                  if (isUsingOllama)
                    ollamaLog.info(`Stream aborted by user`);
                  break;
                }

                messageCount++;

                // Extra logging for Ollama to diagnose issues
                if (isUsingOllama) {
                  const sdkMsgPreview = msg as SdkStreamMessage;
                  ollamaLog.info(`===== MESSAGE #${messageCount} =====`);
                  ollamaLog.info(`Type: ${sdkMsgPreview.type}`);
                  claudeLog.info(
                    `[Ollama] Subtype: ${sdkMsgPreview.subtype || "none"}`,
                  );
                  if (sdkMsgPreview.event) {
                    ollamaLog.info(`Event: ${sdkMsgPreview.event.type}`, {
                      delta_type: sdkMsgPreview.event.delta?.type,
                      content_block_type:
                        sdkMsgPreview.event.content_block?.type,
                    });
                  }
                  if (sdkMsgPreview.message?.content) {
                    claudeLog.info(
                      `[Ollama] Message content blocks:`,
                      sdkMsgPreview.message.content.length,
                    );
                    sdkMsgPreview.message.content.forEach((block, idx) => {
                      claudeLog.info(
                        `[Ollama]   Block ${idx}: type=${block.type}, text_length=${block.text?.length || 0}`,
                      );
                    });
                  }
                }

                // Warn if SDK initialization is slow (MCP delay)
                if (!firstMessageReceived) {
                  firstMessageReceived = true;
                  const timeToFirstMessage = Date.now() - streamIterationStart;
                  perf(`FIRST STREAM MESSAGE received (stream wait: ${timeToFirstMessage}ms, total: ${Date.now() - perfStart}ms)`);
                  if (isUsingOllama) {
                    claudeLog.info(
                      `[Ollama] Time to first message: ${timeToFirstMessage}ms`,
                    );
                  }
                  if (timeToFirstMessage > 5000) {
                    claudeLog.warn(
                      `[claude] SDK initialization took ${(timeToFirstMessage / 1000).toFixed(1)}s (MCP servers loading?)`,
                    );
                  }
                }

                // Log raw message for debugging
                logRawClaudeMessage(input.chatId, msg);

                // Check for error messages from SDK (error can be embedded in message payload!)
                const sdkMsg = msg as SdkStreamMessage;
                if (sdkMsg.type === "error" || sdkMsg.error) {
                  // Extract detailed error text from message content if available
                  // This is where the actual error description lives (e.g., "API Error: Claude Code is unable to respond...")
                  const messageText = sdkMsg.message?.content?.[0]?.text;
                  const errorValue =
                    typeof sdkMsg.error === "string"
                      ? sdkMsg.error
                      : sdkMsg.error?.message;
                  const sdkError =
                    messageText || errorValue || "Unknown SDK error";

                  // Detailed SDK error logging in main process
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] ========================================`,
                  );
                  claudeLog.error(`[CLAUDE SDK ERROR] Raw error: ${sdkError}`);
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] Message type: ${sdkMsg.type}`,
                  );
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] SubChat ID: ${input.subChatId}`,
                  );
                  claudeLog.error(`[CLAUDE SDK ERROR] Chat ID: ${input.chatId}`);
                  claudeLog.error(`[CLAUDE SDK ERROR] CWD: ${input.cwd}`);
                  claudeLog.error(`[CLAUDE SDK ERROR] Mode: ${input.mode}`);
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] Session ID: ${sdkMsg.session_id || "none"}`,
                  );
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] Has custom config: ${!!finalCustomConfig}`,
                  );
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] Is using Ollama: ${isUsingOllama}`,
                  );
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] Model: ${resolvedModel || "default"}`,
                  );
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] Has OAuth token: ${!!claudeCodeToken}`,
                  );
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] MCP servers: ${mcpServersFiltered ? Object.keys(mcpServersFiltered).join(", ") : "none"}`,
                  );
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] Full message:`,
                    JSON.stringify(sdkMsg, null, 2),
                  );
                  claudeLog.error(
                    `[CLAUDE SDK ERROR] ========================================`,
                  );

                  // Categorize SDK-level errors
                  // Use the raw error code (e.g., "invalid_request") for category matching
                  const rawErrorCode = sdkMsg.error || "";
                  let errorCategory = "SDK_ERROR";
                  // Default errorContext to the full error text (which may include detailed message)
                  let errorContext = sdkError;

                  if (
                    rawErrorCode === "authentication_failed" ||
                    sdkError.includes("authentication")
                  ) {
                    errorCategory = "AUTH_FAILED_SDK";
                    errorContext =
                      "Authentication failed - not logged into Claude Code CLI";
                  } else if (
                    String(sdkError).includes("invalid_token") ||
                    String(sdkError).includes("Invalid access token")
                  ) {
                    errorCategory = "MCP_INVALID_TOKEN";
                    errorContext = "Invalid access token. Update MCP settings";
                  } else if (
                    rawErrorCode === "invalid_api_key" ||
                    sdkError.includes("api_key")
                  ) {
                    errorCategory = "INVALID_API_KEY_SDK";
                    errorContext = "Invalid API key in Claude Code CLI";
                  } else if (
                    rawErrorCode === "rate_limit_exceeded" ||
                    sdkError.includes("rate")
                  ) {
                    errorCategory = "RATE_LIMIT_SDK";
                    errorContext = "Session limit reached";
                  } else if (
                    rawErrorCode === "overloaded" ||
                    sdkError.includes("overload")
                  ) {
                    errorCategory = "OVERLOADED_SDK";
                    errorContext = "Claude is overloaded, try again later";
                  } else if (
                    rawErrorCode === "invalid_request" ||
                    sdkError.includes("Usage Policy") ||
                    sdkError.includes("violate")
                  ) {
                    // Usage Policy violation - keep the full detailed error text
                    errorCategory = "USAGE_POLICY_VIOLATION";
                    // errorContext already contains the full message from sdkError
                  }

                  // Compute providerType for frontend error routing
                  const providerType = isUsingOllama
                    ? "ollama"
                    : isUsingLitellm
                      ? "litellm"
                      : finalCustomConfig
                        ? "custom"
                        : "anthropic";

                  // Unified error emit - frontend decides how to handle based on providerType + category
                  safeEmit({
                    type: "error",
                    errorText: errorContext,
                    debugInfo: {
                      category: errorCategory,
                      rawErrorCode,
                      sessionId: sdkMsg.session_id,
                      messageId: sdkMsg.message?.id,
                      providerType,
                    },
                  } as UIMessageChunk);

                  claudeLog.info(
                    `[SD] M:END sub=${subId} reason=sdk_error cat=${errorCategory} n=${chunkCount}`,
                  );
                  sdLog.error(`SDK Error details:`, {
                    errorCategory,
                    errorContext: errorContext.slice(0, 200), // Truncate for log readability
                    rawErrorCode,
                    sessionId: sdkMsg.session_id,
                    messageId: sdkMsg.message?.id,
                    fullMessage: JSON.stringify(sdkMsg, null, 2),
                  });
                  safeEmit({ type: "finish" } as UIMessageChunk);
                  safeComplete();
                  return;
                }

                // Track sessionId for rollback support (available on all messages)
                if (sdkMsg.session_id) {
                  metadata.sessionId = sdkMsg.session_id;
                  currentSessionId = sdkMsg.session_id; // Share with cleanup
                }

                // Track UUID from assistant messages for resumeSessionAt
                if (sdkMsg.type === "assistant" && sdkMsg.uuid) {
                  lastAssistantUuid = sdkMsg.uuid;
                }

                // When result arrives, assign the last assistant UUID to metadata
                // It will be emitted as part of the merged message-metadata chunk below
                if (
                  sdkMsg.type === "result" &&
                  historyEnabled &&
                  lastAssistantUuid &&
                  !abortController.signal.aborted
                ) {
                  metadata.sdkMessageUuid = lastAssistantUuid;
                }

                // Debug: Log system messages from SDK
                if (sdkMsg.type === "system") {
                  // Full log to see all fields including MCP errors
                  claudeLog.info(
                    `[SD] SYSTEM message: subtype=${sdkMsg.subtype}`,
                    JSON.stringify(
                      {
                        cwd: sdkMsg.cwd,
                        mcp_servers: sdkMsg.mcp_servers,
                        tools: sdkMsg.tools,
                        plugins: sdkMsg.plugins,
                        permissionMode: sdkMsg.permissionMode,
                      },
                      null,
                      2,
                    ),
                  );
                }

                // Transform and emit + accumulate
                for (const chunk of transform(msg)) {
                  chunkCount++;
                  lastChunkType = chunk.type;

                  // For message-metadata, inject sdkMessageUuid before emitting
                  // so the frontend receives the full merged metadata in one chunk
                  if (
                    chunk.type === "message-metadata" &&
                    metadata.sdkMessageUuid
                  ) {
                    chunk.messageMetadata = {
                      ...chunk.messageMetadata,
                      sdkMessageUuid: metadata.sdkMessageUuid,
                    };
                  }

                  // Use safeEmit to prevent throws when observer is closed
                  if (!safeEmit(chunk)) {
                    // Observer closed (user clicked Stop), break out of loop
                    claudeLog.info(
                      `[SD] M:EMIT_CLOSED sub=${subId} type=${chunk.type} n=${chunkCount}`,
                    );
                    break;
                  }

                  // Accumulate based on chunk type
                  switch (chunk.type) {
                    case "text-delta":
                      currentText += chunk.delta;
                      break;
                    case "text-end":
                      if (currentText.trim()) {
                        parts.push({ type: "text", text: currentText });
                        currentText = "";
                      }
                      break;
                    case "tool-input-available":
                      // DEBUG: Log tool calls
                      claudeLog.info(
                        `[SD] M:TOOL_CALL sub=${subId} toolName="${chunk.toolName}" mode=${input.mode} callId=${chunk.toolCallId}`,
                      );

                      // Track ExitPlanMode toolCallId so we can stop when it completes
                      if (
                        input.mode === "plan" &&
                        chunk.toolName === "ExitPlanMode"
                      ) {
                        claudeLog.info(
                          `[SD] M:PLAN_TOOL_DETECTED sub=${subId} callId=${chunk.toolCallId}`,
                        );
                        exitPlanModeToolCallId = chunk.toolCallId;
                      }

                      parts.push({
                        type: `tool-${chunk.toolName}`,
                        toolCallId: chunk.toolCallId,
                        toolName: chunk.toolName,
                        input: chunk.input,
                        state: "call",
                        startedAt: Date.now(),
                      });
                      break;
                    case "tool-output-available":
                      const toolPart = parts.find(
                        (p) =>
                          p.type?.startsWith("tool-") &&
                          p.toolCallId === chunk.toolCallId,
                      );
                      if (toolPart) {
                        toolPart.result = chunk.output;
                        toolPart.output = chunk.output; // Backwards compatibility for the UI that relies on output field
                        toolPart.state = "result";

                        // Notify renderer about file changes for Write/Edit tools
                        // Only track non-code files as artifacts (HTML is allowed)
                        if (
                          toolPart.type === "tool-Write" ||
                          toolPart.type === "tool-Edit"
                        ) {
                          const filePath = toolPart.input?.file_path;
                          if (filePath && shouldTrackAsArtifact(filePath)) {
                            // Extract contexts from all tool calls in this message
                            const contexts = extractArtifactContexts(parts);
                            claudeLog.info(
                              `[Claude] Sending file-changed event: path=${filePath} type=${toolPart.type} subChatId=${input.subChatId} contexts=${contexts.length}`,
                            );
                            const windows = BrowserWindow.getAllWindows();
                            for (const win of windows) {
                              win.webContents.send("file-changed", {
                                filePath,
                                type: toolPart.type,
                                subChatId: input.subChatId,
                                contexts,
                              });
                            }
                          }

                          // Hook: 通知文件变更 (fire-and-forget)
                          if (filePath) {
                            getHooks()
                              .call(ChatHook.FileChanged, {
                                sessionId: currentSessionId,
                                projectId: projectId || "",
                                subChatId: input.subChatId,
                                filePath,
                                changeType:
                                  toolPart.type === "tool-Edit"
                                    ? "modify"
                                    : "create",
                              })
                              .catch((err) =>
                                claudeLog.error(
                                  "[Hook] chat:fileChanged error:",
                                  err,
                                ),
                              );
                          }
                        }

                        // Detect git commit success from Bash output
                        // Format: [branch abc1234] commit message
                        if (
                          toolPart.type === "tool-Bash" ||
                          toolPart.toolName === "Bash"
                        ) {
                          const output =
                            typeof chunk.output === "string"
                              ? chunk.output
                              : "";
                          const commitMatch = output.match(
                            /\[([^\]]+)\s+([a-f0-9]{7,})\]/,
                          );
                          if (commitMatch) {
                            const [, branchInfo, commitHash] = commitMatch;
                            claudeLog.info(
                              `[Claude] Git commit detected: hash=${commitHash} branch=${branchInfo} subChatId=${input.subChatId}`,
                            );
                            const windows = BrowserWindow.getAllWindows();
                            for (const win of windows) {
                              win.webContents.send("git-commit-success", {
                                subChatId: input.subChatId,
                                commitHash,
                                branchInfo,
                              });
                            }

                            // Hook: 通知 git commit (fire-and-forget)
                            const commitMsg =
                              output.match(/\[.+?\]\s+(.+)/)?.[1] || "";
                            getHooks()
                              .call(ChatHook.GitCommit, {
                                sessionId: currentSessionId,
                                projectId: projectId || "",
                                subChatId: input.subChatId,
                                commitHash,
                                commitMessage: commitMsg,
                              })
                              .catch((err) =>
                                claudeLog.error(
                                  "[Hook] chat:gitCommit error:",
                                  err,
                                ),
                              );
                          }
                        }

                        // Check if ExitPlanMode just completed
                        // We set planCompleted and abort the SDK to trigger the result message
                        // with token usage data. We don't break immediately - we wait for result.
                        if (
                          exitPlanModeToolCallId &&
                          chunk.toolCallId === exitPlanModeToolCallId
                        ) {
                          claudeLog.info(
                            `[SD] M:PLAN_FINISH sub=${subId} - ExitPlanMode completed, aborting to get result with usage data`,
                          );
                          planCompleted = true;
                          // Emit finish to frontend so it knows plan is done
                          safeEmit({ type: "finish" } as UIMessageChunk);
                          // Abort the SDK to stop further API calls and trigger result message
                          abortController.abort();
                        }

                        // Hook: Record tool output (fire-and-forget)
                        const toolName =
                          toolPart.toolName ||
                          toolPart.type?.replace("tool-", "");
                        if (toolName) {
                          getHooks()
                            .call(ChatHook.ToolOutput, {
                              sessionId: null,
                              projectId: projectId || "",
                              subChatId: input.subChatId,
                              toolName,
                              toolInput: toolPart.input,
                              toolOutput: chunk.output,
                              toolCallId: chunk.toolCallId,
                              promptNumber,
                            })
                            .catch((err) => {
                              claudeLog.error(
                                "[Hook] chat:toolOutput error:",
                                err,
                              );
                            });
                        }
                      }
                      break;
                    case "message-metadata":
                      metadata = { ...metadata, ...chunk.messageMetadata };
                      break;
                    case "system-Compact":
                      // Add system-Compact to parts so it renders in the chat
                      // Find existing part by toolCallId or add new one
                      const existingCompact = parts.find(
                        (p) =>
                          p.type === "system-Compact" &&
                          p.toolCallId === chunk.toolCallId,
                      );
                      if (existingCompact) {
                        existingCompact.state = chunk.state;
                      } else {
                        parts.push({
                          type: "system-Compact",
                          toolCallId: chunk.toolCallId,
                          state: chunk.state,
                        });
                      }
                      break;
                  }

                }
                // Break from stream loop if observer closed (user clicked Stop)
                if (!isObservableActive) {
                  sdLog.info(`M:OBSERVER_CLOSED_STREAM sub=${subId}`);
                  break;
                }
                // Break from stream loop if plan completed AND we've received the result message
                // The result message contains token usage data which we need to record
                if (planCompleted && sdkMsg.type === "result") {
                  sdLog.info(`M:PLAN_BREAK_STREAM sub=${subId} - Got result message after ExitPlanMode`);
                  break;
                }
              }

              // Warn if stream yielded no messages (offline mode issue)
              const streamDuration = Date.now() - streamIterationStart;
              if (isUsingOllama) {
                ollamaLog.info(`===== STREAM COMPLETED =====`);
                ollamaLog.info(`Total messages: ${messageCount}`);
                ollamaLog.info(`Duration: ${streamDuration}ms`);
                ollamaLog.info(`Chunks emitted: ${chunkCount}`);
              }

              if (messageCount === 0) {
                claudeLog.error(
                  `[claude] Stream yielded no messages - model not responding`,
                );
                if (isUsingOllama) {
                  ollamaLog.error(`===== DIAGNOSIS =====`);
                  claudeLog.error(
                    `[Ollama] Problem: Stream completed but NO messages received from SDK`,
                  );
                  ollamaLog.error(`This usually means:`);
                  claudeLog.error(
                    `[Ollama]   1. Ollama doesn't support Anthropic Messages API format (/v1/messages)`,
                  );
                  claudeLog.error(
                    `[Ollama]   2. Model failed to start generating (check Ollama logs: ollama logs)`,
                  );
                  claudeLog.error(
                    `[Ollama]   3. Network issue between Claude SDK and Ollama`,
                  );
                  ollamaLog.error(`===== NEXT STEPS =====`);
                  claudeLog.error(
                    `[Ollama]   1. Check if model works: curl http://localhost:11434/api/generate -d '{"model":"${finalCustomConfig?.model}","prompt":"test"}'`,
                  );
                  claudeLog.error(
                    `[Ollama]   2. Check Ollama version supports Messages API`,
                  );
                  claudeLog.error(
                    `[Ollama]   3. Try using a proxy that converts Anthropic API → Ollama format`,
                  );
                }
              } else if (messageCount === 1 && isUsingOllama) {
                claudeLog.warn(
                  `[Ollama] Only received 1 message (likely just init). No actual content generated.`,
                );
              }
            } catch (streamError) {
              // This catches errors during streaming (like process exit)
              const err = streamError as Error;
              const stderrOutput = stderrLines.join("\n");

              if (isUsingOllama) {
                ollamaLog.error(`===== STREAM ERROR =====`);
                ollamaLog.error(`Error message: ${err.message}`);
                ollamaLog.error(`Error stack:`, err.stack);
                claudeLog.error(
                  `[Ollama] Messages received before error: ${messageCount}`,
                );
                if (stderrOutput) {
                  ollamaLog.error(`Claude binary stderr:`, stderrOutput);
                }
              }

              // Build detailed error message with category
              let errorContext = "Claude streaming error";
              let errorCategory = "UNKNOWN";

              // Check for session-not-found error in stderr
              const isSessionNotFound = stderrOutput?.includes(
                "No conversation found with session ID",
              );

              if (isSessionNotFound) {
                // Clear the invalid session ID from database so next attempt starts fresh
                claudeLog.info(
                  `[claude] Session not found - clearing invalid sessionId from database`,
                );
                // 异步化数据库写入
                await dbRunAsync(
                  db.update(subChats)
                    .set({ sessionId: null })
                    .where(eq(subChats.id, input.subChatId))
                );

                errorContext = "Previous session expired. Please try again.";
                errorCategory = "SESSION_EXPIRED";
              } else if (err.message?.includes("exited with code")) {
                errorContext = "Claude Code process crashed";
                errorCategory = "PROCESS_CRASH";
              } else if (err.message?.includes("ENOENT")) {
                errorContext = "Required executable not found in PATH";
                errorCategory = "EXECUTABLE_NOT_FOUND";
              } else if (
                err.message?.includes("authentication") ||
                err.message?.includes("401")
              ) {
                errorContext = "Authentication failed - check your API key";
                errorCategory = "AUTH_FAILURE";
              } else if (
                err.message?.includes("invalid_api_key") ||
                err.message?.includes("Invalid API Key") ||
                stderrOutput?.includes("invalid_api_key")
              ) {
                errorContext = "Invalid API key";
                errorCategory = "INVALID_API_KEY";
              } else if (
                err.message?.includes("rate_limit") ||
                err.message?.includes("429")
              ) {
                errorContext = "Session limit reached";
                errorCategory = "RATE_LIMIT";
              } else if (
                err.message?.includes("network") ||
                err.message?.includes("ECONNREFUSED") ||
                err.message?.includes("fetch failed")
              ) {
                errorContext = "Network error - check your connection";
                errorCategory = "NETWORK_ERROR";
              }

              // Track error in Sentry (only if app is ready and Sentry is available)
              if (app.isReady() && app.isPackaged) {
                try {
                  const Sentry = await import("@sentry/electron/main");
                  Sentry.captureException(err, {
                    tags: {
                      errorCategory,
                      mode: input.mode,
                    },
                    extra: {
                      context: errorContext,
                      cwd: input.cwd,
                      stderr: stderrOutput || "(no stderr captured)",
                      chatId: input.chatId,
                      subChatId: input.subChatId,
                    },
                  });
                } catch {
                  // Sentry not available or failed to import - ignore
                }
              }

              // Send error with stderr output to frontend (only if not aborted by user)
              if (!abortController.signal.aborted) {
                safeEmit({
                  type: "error",
                  errorText: stderrOutput
                    ? `${errorContext}: ${err.message}\n\nProcess output:\n${stderrOutput}`
                    : `${errorContext}: ${err.message}`,
                  debugInfo: {
                    context: errorContext,
                    category: errorCategory,
                    cwd: input.cwd,
                    mode: input.mode,
                    stderr: stderrOutput || "(no stderr captured)",
                  },
                } as UIMessageChunk);
              }

              // ALWAYS save accumulated parts before returning (even on abort/error)
              claudeLog.info(
                `[SD] M:CATCH_SAVE sub=${subId} aborted=${abortController.signal.aborted} parts=${parts.length}`,
              );
              if (currentText.trim()) {
                parts.push({ type: "text", text: currentText });
              }
              if (parts.length > 0) {
                const assistantMessage = {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  parts,
                  metadata,
                  createdAt: new Date().toISOString(),
                };
                const finalMessages = [...messagesToSave, assistantMessage];
                // 使用 DAL 写入消息 (自动处理迁移)
                await replaceAllMessages(input.subChatId, finalMessages);
                // 仍然需要更新 stats 和 sessionId
                const stats = computePreviewStatsFromMessages(
                  finalMessages,
                  input.mode,
                );
                const statsJson = await jsonStringifyAsync(stats);
                await dbRunAsync(
                  db.update(subChats)
                    .set({
                      statsJson,
                      sessionId: metadata.sessionId,
                      streamId: null,
                      updatedAt: new Date(),
                    })
                    .where(eq(subChats.id, input.subChatId))
                );
                await dbRunAsync(
                  db.update(chats)
                    .set({ updatedAt: new Date() })
                    .where(eq(chats.id, input.chatId))
                );

                // Create snapshot stash for rollback support (on error)
                if (historyEnabled && metadata.sdkMessageUuid && input.cwd) {
                  await createRollbackStash(input.cwd, metadata.sdkMessageUuid);
                }

                // Hook: Record usage statistics (even on error)
                getHooks()
                  .call(ChatHook.StreamError, {
                    subChatId: input.subChatId,
                    chatId: input.chatId,
                    projectId: projectId || "",
                    metadata,
                    error: err instanceof Error
                      ? err
                      : new Error(String(err)),
                    mode: input.mode,
                    finalModel: finalCustomConfig?.model,
                    durationMs: metadata.durationMs,
                  })
                  .catch((err) => {
                    hookLog.error("chat:streamError error:", err);
                  });
              }

              claudeLog.info(
                `[SD] M:END sub=${subId} reason=stream_error cat=${errorCategory} n=${chunkCount} last=${lastChunkType}`,
              );
              safeEmit({ type: "finish" } as UIMessageChunk);
              safeComplete();
              return;
            }

            // 6. Check if we got any response
            if (messageCount === 0 && !abortController.signal.aborted) {
              emitError(
                new Error("No response received from Claude"),
                "Empty response",
              );
              claudeLog.info(
                `[SD] M:END sub=${subId} reason=no_response n=${chunkCount}`,
              );
              safeEmit({ type: "finish" } as UIMessageChunk);
              safeComplete();
              return;
            }

            // 7. Save final messages to DB
            // ALWAYS save accumulated parts, even on abort (so user sees partial responses after reload)
            claudeLog.info(
              `[SD] M:SAVE sub=${subId} aborted=${abortController.signal.aborted} parts=${parts.length}`,
            );

            // Flush any remaining text
            if (currentText.trim()) {
              parts.push({ type: "text", text: currentText });
            }

            const savedSessionId = metadata.sessionId;

            if (parts.length > 0) {
              const assistantMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                parts,
                metadata,
                createdAt: new Date().toISOString(),
              };

              // Log for debugging rollback issues
              sdLog.info("Saving assistant message:", {
                subChatId: input.subChatId,
                messageId: assistantMessage.id,
                hasSdkMessageUuid: !!metadata.sdkMessageUuid,
                sdkMessageUuid: metadata.sdkMessageUuid,
                historyEnabled: input.historyEnabled,
              });

              const finalMessages = [...messagesToSave, assistantMessage];
              // 使用 DAL 写入消息 (自动处理迁移)
              await replaceAllMessages(input.subChatId, finalMessages);
              // 仍然需要更新 stats 和 sessionId
              const stats = computePreviewStatsFromMessages(
                finalMessages,
                input.mode,
              );
              const statsJson = await jsonStringifyAsync(stats);

              await dbRunAsync(
                db.update(subChats)
                  .set({
                    statsJson,
                    sessionId: savedSessionId,
                    streamId: null,
                    updatedAt: new Date(),
                  })
                  .where(eq(subChats.id, input.subChatId))
              );
            } else {
              // No assistant response - just clear streamId
              await dbRunAsync(
                db.update(subChats)
                  .set({
                    sessionId: savedSessionId,
                    streamId: null,
                    updatedAt: new Date(),
                  })
                  .where(eq(subChats.id, input.subChatId))
              );
            }

            // Update parent chat timestamp
            await dbRunAsync(
              db.update(chats)
                .set({ updatedAt: new Date() })
                .where(eq(chats.id, input.chatId))
            );

            // Record usage statistics (if we have token data and projectId)
            // Prefer per-model breakdown from SDK for accurate model attribution
            claudeLog.info(
              `[Usage] metadata at finish:`,
              JSON.stringify({
                hasModelUsage: !!metadata.modelUsage,
                modelUsageKeys: metadata.modelUsage
                  ? Object.keys(metadata.modelUsage)
                  : [],
                inputTokens: metadata.inputTokens,
                outputTokens: metadata.outputTokens,
                totalTokens: metadata.totalTokens,
                sdkMessageUuid: metadata.sdkMessageUuid,
                projectId,
              }),
            );
            // Hook: Record usage statistics (success path)
            getHooks()
              .call(ChatHook.StreamComplete, {
                subChatId: input.subChatId,
                chatId: input.chatId,
                projectId: projectId || "",
                metadata,
                assistantText: currentText,
                mode: input.mode,
                finalModel: finalCustomConfig?.model,
                durationMs: metadata.durationMs,
              })
              .catch((err) => {
                hookLog.error("chat:streamComplete error:", err);
              });

            // Create snapshot stash for rollback support
            if (historyEnabled && metadata.sdkMessageUuid && input.cwd) {
              await createRollbackStash(input.cwd, metadata.sdkMessageUuid);
            }

            // Hook: Record AI response text (fire-and-forget)
            if (projectId && currentText.trim()) {
              getHooks()
                .call(ChatHook.AssistantMessage, {
                  sessionId: null,
                  projectId,
                  subChatId: input.subChatId,
                  text: currentText,
                  messageId: metadata.sdkMessageUuid,
                  promptNumber,
                })
                .catch((err) => {
                  hookLog.error("chat:assistantMessage error:", err);
                });
            }

            // Hook: End session (fire-and-forget)
            getHooks()
              .call(ChatHook.SessionEnd, {
                sessionId: null,
                subChatId: input.subChatId,
                projectId: projectId || "",
              })
              .catch((err) => {
                hookLog.error("chat:sessionEnd error:", err);
              });

            const duration = ((Date.now() - streamStart) / 1000).toFixed(1);
            claudeLog.info(
              `[SD] M:END sub=${subId} reason=ok n=${chunkCount} last=${lastChunkType} t=${duration}s`,
            );
            safeComplete();
          } catch (error) {
            const duration = ((Date.now() - streamStart) / 1000).toFixed(1);
            claudeLog.info(
              `[SD] M:END sub=${subId} reason=unexpected_error n=${chunkCount} t=${duration}s`,
            );
            emitError(error, "Unexpected error");
            safeEmit({ type: "finish" } as UIMessageChunk);
            safeComplete();
          } finally {
            activeSessions.delete(input.subChatId);
          }
        })();

        // Cleanup on unsubscribe
        return () => {
          claudeLog.info(
            `[SD] M:CLEANUP sub=${subId} sessionId=${currentSessionId || "none"}`,
          );
          isObservableActive = false; // Prevent emit after unsubscribe
          abortController.abort();
          activeSessions.delete(input.subChatId);
          clearPendingApprovals("Session ended.", input.subChatId);

          // Hook: 会话清理通知 (fire-and-forget)
          getHooks()
            .call(ChatHook.Cleanup, {
              subChatId: input.subChatId,
              projectId: resolvedProjectId,
            })
            .catch((err) =>
              hookLog.error("chat:cleanup error:", err),
            );

          // Clear streamId since we're no longer streaming.
          // sessionId is NOT saved here — the save block in the async function
          // handles it (saves on normal completion, clears on abort). This avoids
          // a redundant DB write that the cancel mutation would then overwrite.
          const db = getDatabase();
          // 异步化数据库写入 (fire-and-forget)
          dbRunAsync(
            db.update(subChats)
              .set({ streamId: null })
              .where(eq(subChats.id, input.subChatId))
          ).catch((err) => dbLog.error("Failed to clear streamId:", err));
        };
      });
    }),
});

// Merge extracted routers to maintain flat `trpc.claude.*` API paths
import { mergeRouters } from "../index"
import { mcpRouter } from "./claude-mcp-router"
import { sessionRouter } from "./claude-session-router"

export const claudeRouter = mergeRouters(_coreRouter, mcpRouter, sessionRouter);
