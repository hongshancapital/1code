import * as Sentry from "@sentry/electron/renderer"
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"
import { isTextUIPart, isDataUIPart } from "ai"
import { toast } from "sonner"
import {
  agentsLoginModalOpenAtom,
  askUserQuestionTimeoutAtom,
  autoOfflineModeAtom,
  type CustomClaudeConfig,
  disabledMcpServersAtom,
  enableTasksAtom,
  extendedThinkingEnabledAtom,
  historyEnabledAtom,
  selectedOllamaModelAtom,
  sessionInfoAtom,
  showOfflineModeFeaturesAtom,
  userPersonalizationAtom,
  skillAwarenessEnabledAtom,
  betaMemoryEnabledAtom,
  memoryEnabledAtom,
  memoryRecordingEnabledAtom,
} from "../../../lib/atoms"
import { effectiveLlmSelectionAtom, imageProviderIdAtom, imageModelIdAtom, enabledModelsPerProviderAtom, summaryProviderIdAtom, summaryModelIdAtom } from "../../../lib/atoms/model-config"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import {
  askUserQuestionResultsAtom,
  compactingSubChatsAtom,
  expiredUserQuestionsAtom,
  pendingAuthRetryMessageAtom,
  pendingUserQuestionsAtom,
} from "../atoms"
import {
  backgroundTasksAtomFamily,
  createBackgroundTask,
  updateTaskStatus,
} from "../atoms/background-tasks"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { showUserInputRequiredNotification } from "../../sidebar/hooks/use-desktop-notifications"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"

// Error categories and their user-friendly messages
const ERROR_TOAST_CONFIG: Record<
  string,
  {
    title: string
    description: string
    action?: { label: string; onClick: () => void }
  }
> = {
  AUTH_FAILED_SDK: {
    title: "Not logged in",
    description: "Run 'claude login' in your terminal to authenticate",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("claude login"),
    },
  },
  INVALID_API_KEY_SDK: {
    title: "Invalid API key",
    description:
      "Your Claude API key is invalid. Check your CLI configuration.",
  },
  INVALID_API_KEY: {
    title: "Invalid API key",
    description:
      "Your Claude API key is invalid. Check your CLI configuration.",
  },
  RATE_LIMIT_SDK: {
    title: "Session limit reached",
    description: "You've hit the Claude Code usage limit.",
    action: {
      label: "View usage",
      onClick: () =>
        trpcClient.external.openExternal.mutate(
          "https://claude.ai/settings/usage",
        ),
    },
  },
  RATE_LIMIT: {
    title: "Session limit reached",
    description: "You've hit the Claude Code usage limit.",
    action: {
      label: "View usage",
      onClick: () =>
        trpcClient.external.openExternal.mutate(
          "https://claude.ai/settings/usage",
        ),
    },
  },
  OVERLOADED_SDK: {
    title: "Claude is busy",
    description:
      "The service is overloaded. Please try again in a few moments.",
  },
  PROCESS_CRASH: {
    title: "Claude crashed",
    description:
      "The Claude process exited unexpectedly. Try sending your message again or rollback.",
  },
  SESSION_EXPIRED: {
    title: "Session expired",
    description:
      "Your previous chat session expired. Send your message again to start fresh.",
  },
  EXECUTABLE_NOT_FOUND: {
    title: "Claude CLI not found",
    description:
      "Install Claude Code CLI: npm install -g @anthropic-ai/claude-code",
    action: {
      label: "Copy command",
      onClick: () =>
        navigator.clipboard.writeText(
          "npm install -g @anthropic-ai/claude-code",
        ),
    },
  },
  NETWORK_ERROR: {
    title: "Network error",
    description: "Check your internet connection and try again.",
  },
  AUTH_FAILURE: {
    title: "Authentication failed",
    description: "Your session may have expired. Try logging in again.",
  },
  USAGE_POLICY_VIOLATION: {
    title: "Request declined",
    // description will be set from chunk.errorText which contains the full API error message
    description: "",
  },
  // SDK_ERROR and other unknown errors use chunk.errorText for description
}

import i18n from "../../../lib/i18n"
import type { MCPServer, SessionInfo } from "../../../lib/atoms"
import type { PendingUserQuestion } from "../atoms"
import type { BackgroundTaskStatus } from "../types/background-task"

/**
 * Extended stream chunk type for our Claude transport.
 * The subscription returns custom chunk types beyond the standard UIMessageChunk.
 * We use an interface with optional fields since TypeScript discriminated unions
 * don't work well when there's a fallback type with `type: string`.
 */
interface StreamChunk {
  type: string
  // AskUserQuestion fields
  toolUseId?: string
  questions?: PendingUserQuestion["questions"]
  result?: unknown
  // Compacting fields
  state?: string
  // Session init fields
  tools?: string[]
  mcpServers?: MCPServer[]
  plugins?: SessionInfo["plugins"]
  skills?: string[]
  // Task notification fields
  taskId?: string
  status?: BackgroundTaskStatus
  shellId?: string
  summary?: string
  command?: string
  outputFile?: string
  // Error fields
  errorText?: string
  debugInfo?: { category?: string; providerType?: string }
}

type IPCChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string // Original project path for MCP config lookup (when using worktrees)
  mode: "plan" | "agent"
  model?: string
}

// Image attachment type matching the tRPC schema
type ImageAttachment = {
  base64Data: string
  mediaType: string
  filename?: string
}

// File reference for attached files (non-image) and large images
type FileReference = {
  localPath: string
  filename: string
  mediaType?: string
  size?: number
}

// 5MB threshold — images larger than this are sent as file references instead of inline base64
const MAX_IMAGE_SIZE_FOR_INLINE = 5 * 1024 * 1024


// File attachment type for DB persistence (no content, just metadata)
type FileAttachment = {
  filename: string
  mediaType?: string
  size?: number
  localPath?: string
  tempPath?: string
}

export class IPCChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: IPCChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    // Extract prompt, images, and files from last user message
    const lastUser = [...options.messages]
      .reverse()
      .find((m) => m.role === "user")
    const prompt = this.extractText(lastUser)
    const { inlineImages: images, largeImageRefs } = this.extractImagesWithThreshold(lastUser)
    const attachedFiles = this.extractFiles(lastUser)

    // Build file reference hint for AI (non-image files + large images)
    const allFileRefs = [...attachedFiles, ...largeImageRefs]
    let fileHint = ""
    if (allFileRefs.length > 0) {
      const fileList = allFileRefs.map(f => `- ${f.filename} (${f.localPath})`).join("\n")
      fileHint = `\n\n[The user has attached the following file(s). Use the Read tool to access their contents:\n${fileList}]`
    }

    const images = this.extractImages(lastUser)
    const files = this.extractFiles(lastUser)

    // Get sessionId for resume (server preserves sessionId on abort so
    // the next message can resume with full conversation context)
    const lastAssistant = [...options.messages]
      .reverse()
      .find((m) => m.role === "assistant")
    const metadata = lastAssistant?.metadata as AgentMessageMetadata | undefined
    const sessionId = metadata?.sessionId

    // Read extended thinking setting dynamically (so toggle applies to existing chats)
    const thinkingEnabled = appStore.get(extendedThinkingEnabledAtom)
    // Max thinking tokens for extended thinking mode
    // SDK adds +1 internally, so 64000 becomes 64001 which exceeds Opus limit
    // Using 32000 to stay safely under the 64000 max output tokens limit
    const maxThinkingTokens = thinkingEnabled ? 32_000 : undefined
    const historyEnabled = appStore.get(historyEnabledAtom)
    const enableTasks = appStore.get(enableTasksAtom)
    const skillAwarenessEnabled = appStore.get(skillAwarenessEnabledAtom)
    const betaMemoryEnabled = appStore.get(betaMemoryEnabledAtom)
    const memoryEnabled = betaMemoryEnabled ? appStore.get(memoryEnabledAtom) : false
    const memoryRecordingEnabled = betaMemoryEnabled ? appStore.get(memoryRecordingEnabledAtom) : false

    // Read model selection dynamically via unified provider system
    // effectiveLlmSelectionAtom considers session override > global default > litellm fallback
    const effectiveSelection = appStore.get(effectiveLlmSelectionAtom)
    let modelString: string | undefined
    let customConfig: CustomClaudeConfig | undefined

    // Validate: only use model if it's in the enabled models list for that provider
    const enabledModelsMap = appStore.get(enabledModelsPerProviderAtom)
    const enabledModelsForProvider = enabledModelsMap[effectiveSelection.providerId] || []
    let validatedModelId = effectiveSelection.modelId && enabledModelsForProvider.includes(effectiveSelection.modelId)
      ? effectiveSelection.modelId
      : (enabledModelsForProvider.length === 0 ? effectiveSelection.modelId : null)

    // For non-Anthropic providers, fetch config (model, token, baseUrl) via tRPC
    if (effectiveSelection.providerId && effectiveSelection.providerId !== "anthropic") {
      // If no model selected, get default model from provider
      if (!validatedModelId) {
        try {
          const modelsResult = await trpcClient.providers.getModels.query({
            providerId: effectiveSelection.providerId,
          })
          if (modelsResult.defaultModelId) {
            validatedModelId = modelsResult.defaultModelId
            console.log(`[SD] Using default model for ${effectiveSelection.providerId}:`, validatedModelId)
          }
        } catch (err) {
          console.error("[SD] Failed to get default model:", err)
        }
      }

      if (validatedModelId) {
        try {
          const providerConfig = await trpcClient.providers.getConfig.query({
            providerId: effectiveSelection.providerId,
            modelId: validatedModelId,
          })
          if (providerConfig) {
            customConfig = {
              model: providerConfig.model,
              token: providerConfig.token,
              baseUrl: providerConfig.baseUrl,
            }
          }
        } catch (err) {
          console.error("[SD] Failed to get provider config:", err)
        }
      }
    } else {
      // Anthropic OAuth - no customConfig needed, just pass model if specified
      modelString = validatedModelId || undefined
    }

    // Get selected Ollama model for offline mode
    const selectedOllamaModel = appStore.get(selectedOllamaModelAtom)
    // Check if offline mode is enabled in settings
    const showOfflineFeatures = appStore.get(showOfflineModeFeaturesAtom)
    const autoOfflineMode = appStore.get(autoOfflineModeAtom)
    const offlineModeEnabled = showOfflineFeatures && autoOfflineMode

    // Get AskUserQuestion timeout setting (0 = no timeout)
    const askUserQuestionTimeout = appStore.get(askUserQuestionTimeoutAtom)

    const currentMode =
      useAgentSubChatStore
        .getState()
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)
        ?.mode || this.config.mode

    // Stream debug logging
    const subId = this.config.subChatId.slice(-8)
    let chunkCount = 0
    let lastChunkType = ""

    // Get disabled MCP servers for this project
    const disabledServersMap = appStore.get(disabledMcpServersAtom)
    const projectPath = this.config.projectPath || this.config.cwd
    const disabledMcpServers = disabledServersMap[projectPath] || []

    // Get image generation config (if image provider is set)
    let imageConfig: { baseUrl: string; apiKey: string; model: string } | undefined
    const imageProviderId = appStore.get(imageProviderIdAtom)
    const imageModelId = appStore.get(imageModelIdAtom)
    console.log(`[SD] Image atoms: providerId=${JSON.stringify(imageProviderId)} modelId=${JSON.stringify(imageModelId)}`)
    if (imageProviderId && imageModelId) {
      try {
        // getImageConfig returns credentials for any provider type (including anthropic)
        const imgProviderConfig = await trpcClient.providers.getImageConfig.query({
          providerId: imageProviderId,
          modelId: imageModelId,
        })
        console.log(`[SD] Image getImageConfig result:`, imgProviderConfig ? `baseUrl=${imgProviderConfig.baseUrl} model=${imgProviderConfig.model} hasToken=${!!imgProviderConfig.token}` : "null")
        if (imgProviderConfig) {
          imageConfig = {
            baseUrl: imgProviderConfig.baseUrl,
            apiKey: imgProviderConfig.token,
            model: imgProviderConfig.model,
          }
        }
      } catch (err) {
        console.error("[SD] *** Failed to get image provider config ***:", err)
      }
    } else {
      console.log("[SD] Image config skipped: imageProviderId or imageModelId is null")
    }

    // Get user personalization for AI recognition
    const personalization = appStore.get(userPersonalizationAtom)
    const userProfile =
      personalization.preferredName || personalization.personalPreferences
        ? {
            preferredName: personalization.preferredName || undefined,
            personalPreferences: personalization.personalPreferences || undefined,
          }
        : undefined

    console.log(`[SD] R:START sub=${subId} cwd=${this.config.cwd} projectPath=${this.config.projectPath || "(not set)"} customConfig=${customConfig ? "set" : "not set"} disabledMcp=${disabledMcpServers.join(",") || "none"} userProfile=${JSON.stringify(userProfile)}`)

    return new ReadableStream({
      start: (controller) => {
        const sub = trpcClient.claude.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            prompt: prompt + fileHint,
            cwd: this.config.cwd,
            projectPath: this.config.projectPath, // Original project path for MCP config lookup
            mode: currentMode,
            sessionId,
            ...(maxThinkingTokens && { maxThinkingTokens }),
            ...(modelString && { model: modelString }),
            ...(customConfig && { customConfig }),
            ...(selectedOllamaModel && { selectedOllamaModel }),
            historyEnabled,
            offlineModeEnabled,
askUserQuestionTimeout,
            enableTasks,
            skillAwarenessEnabled,
            memoryEnabled,
            memoryRecordingEnabled,
            ...((() => { const sp = appStore.get(summaryProviderIdAtom); const sm = appStore.get(summaryModelIdAtom); return sp && sm ? { summaryProviderId: sp, summaryModelId: sm } : {}; })()),
            ...(images.length > 0 && { images }),
            ...(files.length > 0 && { files }),
            ...(disabledMcpServers.length > 0 && { disabledMcpServers }),
            ...(userProfile && { userProfile }),
            ...(imageConfig && { imageConfig }),
          },
          {
            // Cast chunk to our extended type - the server sends custom chunk types
            // that aren't part of the standard UIMessageChunk type from 'ai'
            onData: (rawChunk) => {
              const chunk = rawChunk as StreamChunk
              chunkCount++
              lastChunkType = chunk.type

              // Handle AskUserQuestion - show question UI and notify user
              if (chunk.type === "ask-user-question" && chunk.toolUseId && chunk.questions) {
                // Read the latest timeout setting (user may have changed it during the conversation)
                const latestTimeoutSetting = appStore.get(askUserQuestionTimeoutAtom)

                const currentMap = appStore.get(pendingUserQuestionsAtom)
                const newMap = new Map(currentMap)
                newMap.set(this.config.subChatId, {
                  subChatId: this.config.subChatId,
                  parentChatId: this.config.chatId,
                  toolUseId: chunk.toolUseId,
                  questions: chunk.questions,
                  timeoutSeconds: latestTimeoutSetting,
                  receivedAt: Date.now(),
                })
                appStore.set(pendingUserQuestionsAtom, newMap)

// Show notification and play sound when user input is required
                showUserInputRequiredNotification("Agent")

                // Clear any expired question (new question replaces it)
                const currentExpired = appStore.get(expiredUserQuestionsAtom)
                if (currentExpired.has(this.config.subChatId)) {
                  const newExpiredMap = new Map(currentExpired)
                  newExpiredMap.delete(this.config.subChatId)
                  appStore.set(expiredUserQuestionsAtom, newExpiredMap)
                }
              }

              // Handle AskUserQuestion timeout - move to expired (keep UI visible)
              if (chunk.type === "ask-user-question-timeout") {
                const currentMap = appStore.get(pendingUserQuestionsAtom)
                const pending = currentMap.get(this.config.subChatId)
                if (pending && pending.toolUseId === chunk.toolUseId) {
                  // Remove from pending
                  const newPendingMap = new Map(currentMap)
                  newPendingMap.delete(this.config.subChatId)
                  appStore.set(pendingUserQuestionsAtom, newPendingMap)

                  // Move to expired (so UI keeps showing the question)
                  const currentExpired = appStore.get(expiredUserQuestionsAtom)
                  const newExpiredMap = new Map(currentExpired)
                  newExpiredMap.set(this.config.subChatId, pending)
                  appStore.set(expiredUserQuestionsAtom, newExpiredMap)
                }
              }

              // Handle AskUserQuestion result - store for real-time updates
              if (chunk.type === "ask-user-question-result" && chunk.toolUseId) {
                const currentResults = appStore.get(askUserQuestionResultsAtom)
                const newResults = new Map(currentResults)
                newResults.set(chunk.toolUseId, chunk.result)
                appStore.set(askUserQuestionResultsAtom, newResults)
              }

              // Handle compacting status - track in atom for UI display
              if (chunk.type === "system-Compact") {
                const compacting = appStore.get(compactingSubChatsAtom)
                const newCompacting = new Set(compacting)
                if (chunk.state === "input-streaming") {
                  // Compacting started
                  newCompacting.add(this.config.subChatId)
                } else {
                  // Compacting finished (output-available)
                  newCompacting.delete(this.config.subChatId)
                }
                appStore.set(compactingSubChatsAtom, newCompacting)
              }

              // Handle session init - store MCP servers, plugins, tools info
              if (chunk.type === "session-init" && chunk.tools && chunk.mcpServers && chunk.plugins && chunk.skills) {
                console.log("[MCP] Received session-init:", {
                  tools: chunk.tools.length,
                  mcpServers: chunk.mcpServers,
                  plugins: chunk.plugins,
                  skills: chunk.skills.length,
                  // Debug: show all tools to check for MCP tools (format: mcp__servername__toolname)
                  allTools: chunk.tools,
                })
                appStore.set(sessionInfoAtom, {
                  tools: chunk.tools,
                  mcpServers: chunk.mcpServers,
                  plugins: chunk.plugins,
                  skills: chunk.skills,
                })
              }

              // Handle task notification - background task status updates
              if (chunk.type === "task-notification" && chunk.taskId && chunk.status) {
                const subChatId = this.config.subChatId
                const tasksAtom = backgroundTasksAtomFamily(subChatId)
                const currentTasks = appStore.get(tasksAtom)
                // Extract to local const for TypeScript narrowing
                const taskId = chunk.taskId
                const taskStatus = chunk.status

                console.log("[BackgroundTask] Received task-notification:", {
                  taskId,
                  status: taskStatus,
                  subChatId,
                  existingTaskIds: currentTasks.map(t => t.taskId),
                })

                if (taskStatus === "running") {
                  // New running task - add to list
                  const newTask = createBackgroundTask(
                    subChatId,
                    taskId,
                    chunk.shellId ?? taskId,
                    chunk.summary ?? "Background task",
                    chunk.command,
                    chunk.outputFile
                  )
                  console.log("[BackgroundTask] Adding new task:", newTask)
                  appStore.set(tasksAtom, [...currentTasks, newTask])
                } else {
                  // Task completed/failed/stopped - update status
                  const taskExists = currentTasks.some(t => t.taskId === taskId)
                  console.log("[BackgroundTask] Updating task status:", {
                    taskId,
                    newStatus: taskStatus,
                    taskExists,
                  })
                  appStore.set(
                    tasksAtom,
                    currentTasks.map((t) =>
                      t.taskId === taskId
                        ? updateTaskStatus(t, taskStatus)
                        : t
                    )
                  )
                }
              }

              // Clear pending questions ONLY when agent has moved on
              // Don't clear on tool-input-* chunks (still building the question input)
              // Clear when we get tool-output-* (answer received) or text-delta (agent moved on)
              const chunkType = chunk.type || ""
              const shouldClearOnChunk =
                chunkType !== "ask-user-question" &&
                chunkType !== "ask-user-question-timeout" &&
                chunkType !== "ask-user-question-result" &&
                !chunkType.startsWith("tool-input") && // Don't clear while input is being built
                chunkType !== "start" &&
                chunkType !== "start-step"

              if (shouldClearOnChunk) {
                const currentMap = appStore.get(pendingUserQuestionsAtom)
                if (currentMap.has(this.config.subChatId)) {
                  const newMap = new Map(currentMap)
                  newMap.delete(this.config.subChatId)
                  appStore.set(pendingUserQuestionsAtom, newMap)
                }
                // NOTE: Do NOT clear expired questions here. After a timeout,
                // the agent continues and emits new chunks — that's expected.
                // Expired questions should persist until the user answers,
                // dismisses, or sends a new message.
              }

              // Handle authentication errors - show Claude login modal
              if (chunk.type === "auth-error") {
                // Store the failed message for retry after successful auth
                // readyToRetry=false prevents immediate retry - modal sets it to true on OAuth success
                appStore.set(pendingAuthRetryMessageAtom, {
                  subChatId: this.config.subChatId,
                  prompt: prompt + fileHint,
                  ...(images.length > 0 && { images }),
                  readyToRetry: false,
                })
                // Show the Claude Code login modal
                appStore.set(agentsLoginModalOpenAtom, true)
                // Use controller.error() instead of controller.close() so that
                // the SDK Chat properly resets status from "streaming" to "ready"
                // This allows user to retry sending messages after failed auth
                console.log(`[SD] R:AUTH_ERR sub=${subId}`)
                controller.error(new Error("Authentication required"))
                return
              }

              // Handle errors - show toast to user FIRST before anything else
              if (chunk.type === "error") {
                const category = chunk.debugInfo?.category || "UNKNOWN"
                const providerType = chunk.debugInfo?.providerType

                // Detailed SDK error logging for debugging
                console.error(`[SDK ERROR] ========================================`)
                console.error(`[SDK ERROR] Category: ${category}`)
                console.error(`[SDK ERROR] Provider: ${providerType}`)
                console.error(`[SDK ERROR] Error text: ${chunk.errorText}`)
                console.error(`[SDK ERROR] Chat ID: ${this.config.chatId}`)
                console.error(`[SDK ERROR] SubChat ID: ${this.config.subChatId}`)
                console.error(`[SDK ERROR] CWD: ${this.config.cwd}`)
                console.error(`[SDK ERROR] Mode: ${currentMode}`)
                if (chunk.debugInfo) {
                  console.error(`[SDK ERROR] Debug info:`, JSON.stringify(chunk.debugInfo, null, 2))
                }
                console.error(`[SDK ERROR] Full chunk:`, JSON.stringify(chunk, null, 2))
                console.error(`[SDK ERROR] ========================================`)

                // Track error in Sentry
                Sentry.captureException(
                  new Error(chunk.errorText || "Claude transport error"),
                  {
                    tags: {
                      errorCategory: category,
                      providerType: providerType || "unknown",
                      mode: currentMode,
                    },
                    extra: {
                      debugInfo: chunk.debugInfo,
                      cwd: this.config.cwd,
                      chatId: this.config.chatId,
                      subChatId: this.config.subChatId,
                    },
                  },
                )

                // Build detailed error string for copying (available for ALL errors)
                const errorDetails = [
                  `Error: ${chunk.errorText || "Unknown error"}`,
                  `Category: ${category}`,
                  `Provider: ${providerType || "unknown"}`,
                  `Chat ID: ${this.config.chatId}`,
                  `SubChat ID: ${this.config.subChatId}`,
                  `CWD: ${this.config.cwd}`,
                  `Mode: ${currentMode}`,
                  `Timestamp: ${new Date().toISOString()}`,
                  chunk.debugInfo ? `Debug Info: ${JSON.stringify(chunk.debugInfo, null, 2)}` : null,
                ].filter(Boolean).join("\n")

                // ── Anthropic auth/permission errors → show login modal + auto-retry ──
                const ANTHROPIC_REAUTH_CATEGORIES = new Set([
                  "AUTH_FAILED_SDK",
                  "INVALID_API_KEY_SDK",
                  "INVALID_API_KEY",
                  "AUTH_FAILURE",
                  "USAGE_POLICY_VIOLATION",
                ])
                if (providerType === "anthropic" && ANTHROPIC_REAUTH_CATEGORIES.has(category)) {
                  appStore.set(pendingAuthRetryMessageAtom, {
                    subChatId: this.config.subChatId,
                    prompt,
                    ...(images.length > 0 && { images }),
                    readyToRetry: false,
                  })
                  appStore.set(agentsLoginModalOpenAtom, true)
                  console.log(`[SD] R:AUTH_ERR sub=${subId} cat=${category}`)
                  controller.error(new Error("Authentication required"))
                  return
                }

                // ── LiteLLM errors → toast with office network / VPN hint ──
                if (providerType === "litellm") {
                  toast.error(i18n.t("toast:error.litellmConnection"), {
                    description: i18n.t("toast:error.litellmConnectionDesc"),
                    duration: 15000,
                    action: {
                      label: "Copy Error",
                      onClick: () => {
                        navigator.clipboard.writeText(errorDetails)
                        toast.success("Error details copied to clipboard")
                      },
                    },
                  })
                } else {
                  // ── Other errors (custom, ollama, unknown) → standard toast ──
                  const config = ERROR_TOAST_CONFIG[category]
                  const title = config?.title || "Claude error"
                  const rawDescription = config?.description || chunk.errorText || "An unexpected error occurred"
                  const description = rawDescription.length > 300
                    ? rawDescription.slice(0, 300) + "..."
                    : rawDescription

                  toast.error(title, {
                    description,
                    duration: 12000,
                    action: {
                      label: "Copy Error",
                      onClick: () => {
                        navigator.clipboard.writeText(errorDetails)
                        toast.success("Error details copied to clipboard")
                      },
                    },
                  })
                }
              }

              // Try to enqueue, but don't crash if stream is already closed
              // rawChunk comes from tRPC subscription and may include custom chunk types
              // beyond the standard UIMessageChunk type from 'ai' package
              try {
                controller.enqueue(rawChunk as UIMessageChunk)
              } catch (e) {
                // CRITICAL: Log when enqueue fails - this could explain missing chunks!
                console.log(`[SD] R:ENQUEUE_ERR sub=${subId} type=${chunk.type} n=${chunkCount} err=${e}`)
              }

              if (chunk.type === "finish") {
                console.log(`[SD] R:FINISH sub=${subId} n=${chunkCount}`)
                try {
                  controller.close()
                } catch {
                  // Already closed
                }
              }
            },
            onError: (err: Error) => {
              console.log(`[SD] R:ERROR sub=${subId} n=${chunkCount} last=${lastChunkType} err=${err.message}`)

              // Clear compacting state on error (prevent UI from being stuck)
              const compacting = appStore.get(compactingSubChatsAtom)
              if (compacting.has(this.config.subChatId)) {
                const newCompacting = new Set(compacting)
                newCompacting.delete(this.config.subChatId)
                appStore.set(compactingSubChatsAtom, newCompacting)
              }

              // Track transport errors in Sentry
              Sentry.captureException(err, {
                tags: {
                  errorCategory: "TRANSPORT_ERROR",
                  mode: currentMode,
                },
                extra: {
                  cwd: this.config.cwd,
                  chatId: this.config.chatId,
                  subChatId: this.config.subChatId,
                },
              })

              controller.error(err)
            },
            onComplete: () => {
              console.log(`[SD] R:COMPLETE sub=${subId} n=${chunkCount} last=${lastChunkType}`)

              // Clear compacting state on complete (in case compact_boundary wasn't received)
              const compacting = appStore.get(compactingSubChatsAtom)
              if (compacting.has(this.config.subChatId)) {
                const newCompacting = new Set(compacting)
                newCompacting.delete(this.config.subChatId)
                appStore.set(compactingSubChatsAtom, newCompacting)
              }

              // Note: Don't clear pending questions here - let active-chat.tsx handle it
              // via the stream stop detection effect. Clearing here causes race conditions
              // where sync effect immediately restores from messages.
              try {
                controller.close()
              } catch {
                // Already closed
              }
            },
          },
        )

        // Handle abort
        options.abortSignal?.addEventListener("abort", () => {
          console.log(`[SD] R:ABORT sub=${subId} n=${chunkCount} last=${lastChunkType}`)

          // Clear compacting state on abort
          const compacting = appStore.get(compactingSubChatsAtom)
          if (compacting.has(this.config.subChatId)) {
            const newCompacting = new Set(compacting)
            newCompacting.delete(this.config.subChatId)
            appStore.set(compactingSubChatsAtom, newCompacting)
          }

          sub.unsubscribe()
          // trpcClient.claude.cancel.mutate({ subChatId: this.config.subChatId })
          try {
            controller.close()
          } catch {
            // Already closed
          }
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // Local Electron app 不支持 HTTP 流重连。
    // useChat 配置 resume: false，确保此方法不会被调用。
    // 即使被调用，返回 null 也是安全的（AI SDK 会跳过重连）。
    return null
  }

  private extractText(msg: UIMessage | undefined): string {
    if (!msg) return ""
    if (msg.parts) {
      const textParts: string[] = []
      const fileContents: string[] = []
      const fileRefs: string[] = []

      for (const p of msg.parts) {
        if (isTextUIPart(p)) {
          textParts.push(p.text)
        } else if (isDataUIPart(p) && p.type === "data-file-content") {
          // Hidden file content - add to prompt but not displayed in UI
          const data = p.data as { filePath?: string; content?: string }
          const fileName = data.filePath?.split("/").pop() || data.filePath || "file"
          fileContents.push(`\n--- ${fileName} ---\n${data.content ?? ""}`)
        } else if (isDataUIPart(p) && p.type === "data-file") {
          // Non-image file attachment - pass file path so AI can read it
          const data = p.data as { localPath?: string; tempPath?: string; filename?: string; size?: number }
          const filePath = data.localPath || data.tempPath
          if (filePath) {
            const sizeInfo = data.size ? ` (${(data.size / 1024).toFixed(1)}KB)` : ""
            fileRefs.push(`- ${data.filename || "file"}${sizeInfo}: ${filePath}`)
          }
        }
      }

      // Combine text, file contents, and file references
      let result = textParts.join("\n") + fileContents.join("")
      if (fileRefs.length > 0) {
        result += `\n\n[The user has attached the following file(s). Use the Read tool to access their contents:\n${fileRefs.join("\n")}]`
      }
      return result
    }
    return ""
  }

  /**
   * Extract images from message parts with size threshold.
   * Small images (<5MB base64) are returned inline for direct API transmission.
   * Large images are returned as file references for AI to read via tools.
   */
  private extractImagesWithThreshold(msg: UIMessage | undefined): {
    inlineImages: ImageAttachment[]
    largeImageRefs: FileReference[]
  } {
    if (!msg || !msg.parts) return { inlineImages: [], largeImageRefs: [] }

    const inlineImages: ImageAttachment[] = []
    const largeImageRefs: FileReference[] = []

    for (const part of msg.parts) {
      // Check for data-image parts with base64 data
      if (isDataUIPart(part) && part.type === "data-image") {
        const data = part.data as { base64Data?: string; mediaType?: string; filename?: string; localPath?: string }
        if (data.base64Data && data.mediaType) {
          // Check if image exceeds inline size threshold
          const estimatedBytes = (data.base64Data.length * 3) / 4
          if (estimatedBytes > MAX_IMAGE_SIZE_FOR_INLINE && data.localPath) {
            // Large image — send as file reference instead
            largeImageRefs.push({
              localPath: data.localPath,
              filename: data.filename || "image",
              mediaType: data.mediaType,
              size: Math.round(estimatedBytes),
            })
          } else {
            // Small image — send inline as base64
            inlineImages.push({
              base64Data: data.base64Data,
              mediaType: data.mediaType,
              filename: data.filename,
            })
          }
        }
      }
    }

    return { inlineImages, largeImageRefs }
  }

  /**
   * Extract non-image file attachments from message parts.
   * Returns file references (path + metadata) for AI to read via tools.
   */
  private extractFiles(msg: UIMessage | undefined): FileReference[] {
    if (!msg || !msg.parts) return []

    const files: FileReference[] = []

    for (const part of msg.parts) {
      if (isDataUIPart(part) && part.type === "data-file") {
        const data = part.data as { localPath?: string; filename?: string; mediaType?: string; size?: number }
        if (data.localPath) {
          files.push({
            localPath: data.localPath,
            filename: data.filename || data.localPath.split("/").pop() || "file",
            mediaType: data.mediaType,
            size: data.size,
          })
        }
      }
    }

    return files
  }

  /**
   * Extract file attachments from message parts
   * Looks for parts with type "data-file" that have path info
   */
  private extractFiles(msg: UIMessage | undefined): FileAttachment[] {
    if (!msg || !msg.parts) return []

    const files: FileAttachment[] = []

    for (const part of msg.parts) {
      if (isDataUIPart(part) && part.type === "data-file") {
        const data = part.data as {
          filename?: string
          mediaType?: string
          size?: number
          localPath?: string
          tempPath?: string
        }
        if (data.filename) {
          files.push({
            filename: data.filename,
            mediaType: data.mediaType,
            size: data.size,
            localPath: data.localPath,
            tempPath: data.tempPath,
          })
        }
      }
    }

    return files
  }
}
