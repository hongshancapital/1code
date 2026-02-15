/**
 * Prompt 构建工具
 *
 * 从 claude.ts 提取的 Prompt 相关逻辑：
 * - mergeUnansweredMessages — 合并中断后遗失的用户消息
 * - buildImagePrompt — 将图片附件转换为 SDK 消息格式
 * - buildOllamaContext — 为 Ollama 构建完整上下文（历史 + profile + runtime）
 */

import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import * as fs from "fs/promises";
import path from "path";

/**
 * Merge previous unanswered user messages into the current prompt.
 *
 * When a user interrupts an ongoing generation, the SDK rolls back to the last
 * assistant message. This causes any intermediate user messages (between the
 * last assistant message and the current one) to be lost from the SDK's context.
 * We must manually merge them into the current prompt.
 */
export function mergeUnansweredMessages(
  existingMessages: Array<{ role: string; parts?: any[] }>,
  currentPrompt: string,
): string {
  const previousUnansweredMessages: string[] = [];

  // Iterate backwards through existing messages to find continuous user messages at the tail
  // existingMessages does NOT include the current message yet
  for (let i = existingMessages.length - 1; i >= 0; i--) {
    const msg = existingMessages[i];
    if (msg.role === "assistant") break;
    if (msg.role === "user") {
      // Extract text parts
      const text = msg.parts
        ?.filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n");
      if (text && text.trim())
        previousUnansweredMessages.unshift(text);
    }
  }

  if (previousUnansweredMessages.length > 0) {
    console.log(
      `[claude] Merging ${previousUnansweredMessages.length} previous unanswered messages into prompt`,
    );
    // Join with double newlines to separate distinct messages clearly
    return `${previousUnansweredMessages.join("\n\n")}\n\n${currentPrompt}`;
  }

  return currentPrompt;
}

/** Supported image media types (matches Anthropic SDK) */
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Image attachment type (matches claude.ts schema) */
interface ImageInput {
  base64Data: string;
  mediaType: string;
  filename?: string;
  localPath?: string;
  tempPath?: string;
}

/**
 * Build an SDK-compatible prompt with image attachments.
 * Saves images to disk and creates an AsyncIterable<SDKUserMessage>.
 *
 * Returns the prompt as an AsyncIterable if images exist, otherwise null.
 */
export async function buildImagePrompt(
  images: ImageInput[],
  finalPrompt: string,
  cwd: string,
): Promise<AsyncIterable<SDKUserMessage> | null> {
  if (!images || images.length === 0) return null;

  // Save uploaded images to disk so MCP tools (e.g. edit_image) can access them by path
  const uploadsDir = path.join(cwd, "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  const savedImagePaths: string[] = [];
  for (const img of images) {
    try {
      const extMap: Record<string, string> = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
      };
      const ext = extMap[img.mediaType] || ".png";
      const baseName = img.filename
        ? path
            .basename(img.filename, path.extname(img.filename))
            .replace(/[^a-zA-Z0-9._-]/g, "_")
        : String(Date.now());
      const filename = `upload_${baseName}${ext}`;
      const filePath = path.join(uploadsDir, filename);

      await fs.writeFile(
        filePath,
        Buffer.from(img.base64Data, "base64"),
      );
      savedImagePaths.push(filePath);
      console.log(`[claude] Saved uploaded image to: ${filePath}`);
    } catch (err) {
      console.error(`[claude] Failed to save uploaded image:`, err);
    }
  }

  // Create message content array with images first, then text
  const messageContent: ContentBlockParam[] = images.map((img) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: img.mediaType as ImageMediaType,
      data: img.base64Data,
    },
  }));

  // Add text with saved image paths info so Claude can reference them in MCP tool calls
  const imagePathsHint =
    savedImagePaths.length > 0
      ? `\n\n[System: The uploaded image(s) have been saved to disk at: ${savedImagePaths.join(", ")}. Use these paths if you need to pass them to tools like edit_image.]`
      : "";
  if (finalPrompt.trim() || imagePathsHint) {
    messageContent.push({
      type: "text" as const,
      text: (finalPrompt + imagePathsHint).trim(),
    });
  }

  // Create an async generator that yields a single SDKUserMessage
  async function* createPromptWithImages(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: messageContent,
      },
      parent_tool_use_id: null,
      session_id: "", // SDK fills this automatically
    };
  }

  return createPromptWithImages();
}

/** Parameters for Ollama context building */
export interface OllamaContextParams {
  existingMessages: Array<{ role: string; parts?: any[] }>;
  prompt: string;
  cwd: string;
  projectPath?: string;
  resolvedModel?: string;
  agentsMdContent?: string;
  userProfile?: {
    preferredName?: string;
    personalPreferences?: string;
  };
  getCachedRuntimeEnvironment: () => Promise<{
    tools: Array<{ category: string; name: string; version?: string }>;
  }>;
}

/**
 * Build complete Ollama context with conversation history, user profile, and runtime info.
 *
 * Ollama doesn't have server-side sessions, so we must include full history
 * in the prompt itself.
 */
export async function buildOllamaContext(
  params: OllamaContextParams,
): Promise<string> {
  const {
    existingMessages,
    prompt,
    cwd,
    projectPath,
    resolvedModel,
    agentsMdContent,
    userProfile,
    getCachedRuntimeEnvironment: getRuntimeEnv,
  } = params;

  // Format conversation history from existingMessages (excluding current message)
  // IMPORTANT: Include tool calls info so model knows what files were read/edited
  let historyText = "";
  if (existingMessages.length > 0) {
    const historyParts: string[] = [];
    for (const msg of existingMessages) {
      if (msg.role === "user") {
        // Extract text from user message parts
        const textParts =
          msg.parts
            ?.filter((p: any) => p.type === "text")
            .map((p: any) => p.text) || [];
        if (textParts.length > 0) {
          historyParts.push(`User: ${textParts.join("\n")}`);
        }
      } else if (msg.role === "assistant") {
        // Extract text AND tool calls from assistant message parts
        const parts = msg.parts || [];
        const textParts: string[] = [];
        const toolSummaries: string[] = [];

        for (const p of parts) {
          if (p.type === "text" && p.text) {
            textParts.push(p.text);
          } else if (
            p.type === "tool_use" ||
            p.type === "tool-use"
          ) {
            // Include brief tool call info - this is critical for context!
            const toolName = p.name || p.tool || "unknown";
            const toolInput = p.input || {};
            // Extract key info based on tool type
            let toolInfo = `[Used ${toolName}`;
            if (
              toolName === "Read" &&
              (toolInput.file_path || toolInput.file)
            ) {
              toolInfo += `: ${toolInput.file_path || toolInput.file}`;
            } else if (toolName === "Edit" && toolInput.file_path) {
              toolInfo += `: ${toolInput.file_path}`;
            } else if (
              toolName === "Write" &&
              toolInput.file_path
            ) {
              toolInfo += `: ${toolInput.file_path}`;
            } else if (toolName === "Glob" && toolInput.pattern) {
              toolInfo += `: ${toolInput.pattern}`;
            } else if (toolName === "Grep" && toolInput.pattern) {
              toolInfo += `: "${toolInput.pattern}"`;
            } else if (toolName === "Bash" && toolInput.command) {
              const cmd = String(toolInput.command).slice(0, 50);
              toolInfo += `: ${cmd}${toolInput.command.length > 50 ? "..." : ""}`;
            }
            toolInfo += "]";
            toolSummaries.push(toolInfo);
          }
        }

        // Combine text and tool summaries
        let assistantContent = "";
        if (textParts.length > 0) {
          assistantContent = textParts.join("\n");
        }
        if (toolSummaries.length > 0) {
          if (assistantContent) {
            assistantContent += "\n" + toolSummaries.join(" ");
          } else {
            assistantContent = toolSummaries.join(" ");
          }
        }
        if (assistantContent) {
          historyParts.push(`Assistant: ${assistantContent}`);
        }
      }
    }
    if (historyParts.length > 0) {
      // Limit history to last ~10000 chars to avoid context overflow
      let history = historyParts.join("\n\n");
      if (history.length > 10000) {
        history =
          "...(earlier messages truncated)...\n\n" +
          history.slice(-10000);
      }
      historyText = `[CONVERSATION HISTORY]
${history}
[/CONVERSATION HISTORY]

`;
      console.log(
        `[Ollama] Added ${historyParts.length} messages to history (${history.length} chars)`,
      );
    }
  }

  // Build user profile section for Ollama context
  let ollamaUserProfile = "";
  if (userProfile) {
    const { preferredName, personalPreferences } = userProfile;
    const profileParts: string[] = [];
    if (preferredName?.trim()) {
      profileParts.push(
        `- Preferred name: ${preferredName.trim()}`,
      );
    }
    if (personalPreferences?.trim()) {
      profileParts.push(
        `- Personal preferences: ${personalPreferences.trim()}`,
      );
    }
    if (profileParts.length > 0) {
      ollamaUserProfile = `\n\n[USER PROFILE]\n${profileParts.join("\n")}\n[/USER PROFILE]`;
    }
  }

  // Get runtime environment for Ollama context
  let ollamaRuntimeInfo = "";
  try {
    const runtimeEnv = await getRuntimeEnv();
    if (runtimeEnv.tools.length > 0) {
      const toolsList = runtimeEnv.tools
        .map(
          (t) =>
            `- ${t.category}: ${t.name}${t.version ? ` (${t.version})` : ""}`,
        )
        .join("\n");
      ollamaRuntimeInfo = `\n\n[RUNTIME]\nAvailable tools:\n${toolsList}\n[/RUNTIME]`;
    }
  } catch (e) {
    console.warn("[Ollama] Failed to get runtime environment:", e);
  }

  const ollamaContext = `[CONTEXT]
You are a coding assistant in OFFLINE mode (Ollama model: ${resolvedModel || "unknown"}).
Project: ${projectPath || cwd}
Working directory: ${cwd}

IMPORTANT: When using tools, use these EXACT parameter names:
- Read: use "file_path" (not "file")
- Write: use "file_path" and "content"
- Edit: use "file_path", "old_string", "new_string"
- Glob: use "pattern" (e.g. "**/*.ts") and optionally "path"
- Grep: use "pattern" and optionally "path"
- Bash: use "command"

When asked about the project, use Glob to find files and Read to examine them.
Be concise and helpful.
[/CONTEXT]${ollamaUserProfile}${ollamaRuntimeInfo}${
    agentsMdContent
      ? `

[AGENTS.MD]
${agentsMdContent}
[/AGENTS.MD]`
      : ""
  }

${historyText}[CURRENT REQUEST]
${prompt}
[/CURRENT REQUEST]`;

  console.log("[Ollama] Context prefix added to prompt");
  return ollamaContext;
}
