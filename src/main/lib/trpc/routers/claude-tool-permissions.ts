/**
 * canUseTool 权限系统 - 处理工具调用的权限判断
 *
 * 包含：
 * - Chat 模式阻断（playground 下禁止文件工具）
 * - Plan 模式限制（仅允许 .md 文件修改）
 * - AskUserQuestion 交互式问答处理（含超时）
 * - Ollama 参数修复
 */

import {
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import {
  PLAN_MODE_BLOCKED_TOOLS,
  CHAT_MODE_BLOCKED_TOOLS,
  type UIMessageChunk,
} from "../../claude";
import { fixOllamaToolParameters } from "./claude-ollama-fix";
import type {
  AskUserQuestionInput,
  ToolPermissionResponse,
} from "./claude-stream-types";

interface ToolPermissionDeps {
  isUsingOllama: boolean
  mode: string
  cwd: string
  subChatId: string
  isPlaygroundPath: (cwd: string) => boolean
  safeEmit: (chunk: UIMessageChunk) => void
  pendingToolApprovals: Map<
    string,
    {
      subChatId: string
      resolve: (decision: {
        approved: boolean
        message?: string
        updatedInput?: unknown
      }) => void
    }
  >
  parts: Array<{
    toolCallId?: string
    type?: string
    result?: unknown
    state?: string
  }>
}

export function createCanUseTool(deps: ToolPermissionDeps) {
  const {
    isUsingOllama,
    mode,
    cwd,
    subChatId,
    isPlaygroundPath,
    safeEmit,
    pendingToolApprovals,
    parts,
  } = deps

  return async (
    toolName: string,
    toolInput: Record<string, unknown>,
    options: { toolUseID: string },
  ): Promise<PermissionResult> => {
    if (isUsingOllama) {
      fixOllamaToolParameters(toolName, toolInput);
    }

    if (isPlaygroundPath(cwd)) {
      if (CHAT_MODE_BLOCKED_TOOLS.has(toolName)) {
        return {
          behavior: "deny" as const,
          message: `Tool "${toolName}" is not available in chat mode. To work with files, please convert this chat to a workspace (Cowork or Coding mode).`,
        };
      }
    }

    if (mode === "plan") {
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
      safeEmit({
        type: "ask-user-question",
        toolUseId: toolUseID,
        questions: askInput.questions,
      } as UIMessageChunk);

      const SAFETY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

      const response = await new Promise<{
        approved: boolean;
        message?: string;
        updatedInput?: unknown;
      }>((resolve) => {
        const timeoutId = setTimeout(() => {
          pendingToolApprovals.delete(toolUseID);
          safeEmit({
            type: "ask-user-question-timeout",
            toolUseId: toolUseID,
          } as UIMessageChunk);
          resolve({ approved: false, message: "Timed out" });
        }, SAFETY_TIMEOUT_MS);

        pendingToolApprovals.set(toolUseID, {
          subChatId,
          resolve: (d) => {
            if (timeoutId) clearTimeout(timeoutId);
            resolve(d);
          },
        });
      });

      const askToolPart = parts.find(
        (p) =>
          p.toolCallId === toolUseID &&
          p.type === "tool-AskUserQuestion",
      );

      if (!response.approved) {
        const errorMessage = response.message || "Skipped";
        if (askToolPart) {
          askToolPart.result = errorMessage;
          askToolPart.state = "result";
        }
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

      const answers = (
        response.updatedInput as ToolPermissionResponse["updatedInput"]
      )?.answers;
      const answerResult = { answers };
      if (askToolPart) {
        askToolPart.result = answerResult;
        askToolPart.state = "result";
      }
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
  };
}
