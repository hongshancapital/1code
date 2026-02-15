/**
 * Tool Permission Policies
 *
 * Policies:
 * - AllowAllPolicy: Default permissive policy (also used as AgentModePolicy)
 * - PlanModePolicy: Restricts tools in plan mode (only .md files can be edited)
 * - ChatModePolicy: Blocks file operations in chat/playground mode
 * - OllamaPolicy: Fixes common parameter mistakes from local models
 * - AutomationPolicy: Safe subset of tools for automated tasks
 * - CompositePolicy: Combines multiple policies (first deny wins)
 */

import type {
  ToolPermissionPolicy,
  ToolPermissionDecision,
  ToolContext,
} from "../engine-types"
import { createLogger } from "../../logger"

const ollamaLog = createLogger("Ollama")


// ============================================================================
// Tool Sets
// ============================================================================

export const PLAN_MODE_BLOCKED_TOOLS = new Set([
  "Bash",
  "NotebookEdit",
])

export const CHAT_MODE_BLOCKED_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "NotebookEdit",
  "LS",
  "Find",
])

export const AUTOMATION_BLOCKED_TOOLS = new Set([
  "AskUserQuestion",
])

// ============================================================================
// Shared Helpers
// ============================================================================

const ALLOW = (toolInput: Record<string, unknown>): ToolPermissionDecision => ({
  behavior: "allow",
  updatedInput: toolInput,
})

const DENY = (message: string): ToolPermissionDecision => ({
  behavior: "deny",
  message,
})

// ============================================================================
// Policy Implementations
// ============================================================================

/**
 * Default permissive policy — allows all tools unchanged.
 * Also serves as AgentModePolicy (they are identical).
 */
export class AllowAllPolicy implements ToolPermissionPolicy {
  canUseTool(
    _toolName: string,
    toolInput: Record<string, unknown>,
    _context: ToolContext
  ): ToolPermissionDecision {
    return ALLOW(toolInput)
  }
}

/** @deprecated Use AllowAllPolicy directly */
export const AgentModePolicy = AllowAllPolicy

/**
 * Plan mode — only .md files can be edited, Bash/NotebookEdit blocked.
 */
export class PlanModePolicy implements ToolPermissionPolicy {
  canUseTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    _context: ToolContext
  ): ToolPermissionDecision {
    if (toolName === "Edit" || toolName === "Write") {
      const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : ""
      if (!/\.md$/i.test(filePath)) {
        return DENY('Only ".md" files can be modified in plan mode.')
      }
    }

    if (PLAN_MODE_BLOCKED_TOOLS.has(toolName)) {
      return DENY(`Tool "${toolName}" blocked in plan mode.`)
    }

    return ALLOW(toolInput)
  }
}

/**
 * Chat/playground mode — blocks all file operations.
 */
export class ChatModePolicy implements ToolPermissionPolicy {
  canUseTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    _context: ToolContext
  ): ToolPermissionDecision {
    if (CHAT_MODE_BLOCKED_TOOLS.has(toolName)) {
      return DENY(
        `Tool "${toolName}" is not available in chat mode. To work with files, please convert this chat to a workspace (Cowork or Coding mode).`
      )
    }
    return ALLOW(toolInput)
  }
}

/**
 * Ollama policy — fixes common parameter name mistakes from local models.
 * Uses a declarative field mapping table instead of per-tool if/else.
 */
export class OllamaPolicy implements ToolPermissionPolicy {
  /**
   * Mapping: toolName → { wrongFieldName → correctFieldName }
   */
  private static readonly FIELD_FIXES: Record<string, Record<string, string>> = {
    Read:  { file: "file_path" },
    Write: { file: "file_path" },
    Edit:  { file: "file_path" },
    Glob:  { directory: "path", dir: "path" },
    Grep:  { query: "pattern", directory: "path" },
    Bash:  { cmd: "command" },
  }

  canUseTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    _context: ToolContext
  ): ToolPermissionDecision {
    const fixes = OllamaPolicy.FIELD_FIXES[toolName]
    if (!fixes) return ALLOW(toolInput)

    const updatedInput = { ...toolInput }
    let didFix = false

    for (const [wrongKey, correctKey] of Object.entries(fixes)) {
      if (updatedInput[wrongKey] !== undefined && updatedInput[correctKey] === undefined) {
        updatedInput[correctKey] = updatedInput[wrongKey]
        delete updatedInput[wrongKey]
        didFix = true
      }
    }

    if (didFix) {
      ollamaLog.info(`Fixed ${toolName} tool parameters`)
    }

    return ALLOW(updatedInput)
  }
}

/**
 * Automation policy — blocks tools requiring user interaction.
 */
export class AutomationPolicy implements ToolPermissionPolicy {
  canUseTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    _context: ToolContext
  ): ToolPermissionDecision {
    if (AUTOMATION_BLOCKED_TOOLS.has(toolName)) {
      return DENY(
        `Tool "${toolName}" is not available in automation mode. Automation tasks cannot request user input.`
      )
    }
    return ALLOW(toolInput)
  }
}

/**
 * Composite policy — chains multiple policies; first deny wins.
 * Each policy can transform the input for the next one (e.g. Ollama fixes).
 */
export class CompositePolicy implements ToolPermissionPolicy {
  private policies: ToolPermissionPolicy[]

  constructor(policies: ToolPermissionPolicy[]) {
    this.policies = policies
  }

  async canUseTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolPermissionDecision> {
    let currentInput = toolInput

    for (const policy of this.policies) {
      const decision = await policy.canUseTool(toolName, currentInput, context)
      if (decision.behavior === "deny") return decision
      if (decision.updatedInput) currentInput = decision.updatedInput
    }

    return ALLOW(currentInput)
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a policy for the given execution context.
 */
export function createPolicy(context: {
  mode: "plan" | "agent"
  isPlayground: boolean
  isOllama: boolean
}): ToolPermissionPolicy {
  const policies: ToolPermissionPolicy[] = []

  // Ollama fixes first (parameter corrections before any deny check)
  if (context.isOllama) {
    policies.push(new OllamaPolicy())
  }

  if (context.isPlayground) {
    policies.push(new ChatModePolicy())
  }

  if (context.mode === "plan") {
    policies.push(new PlanModePolicy())
  }

  if (policies.length === 0) {
    return new AllowAllPolicy()
  }

  return new CompositePolicy(policies)
}

/**
 * Create an automation policy (optionally with Ollama parameter fixes).
 */
export function createAutomationPolicy(isOllama = false): ToolPermissionPolicy {
  const policies: ToolPermissionPolicy[] = []

  if (isOllama) {
    policies.push(new OllamaPolicy())
  }

  policies.push(new AutomationPolicy())

  return new CompositePolicy(policies)
}
