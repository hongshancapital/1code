/**
 * Observation Parser
 * Rule-based parser for generating observations from tool calls
 * Borrowed from claude-mem architecture, but uses rules instead of AI
 */

import type { ParsedObservation, ObservationType } from "./types"

/**
 * Parse tool output to generate an observation
 * Returns null for tools that should be skipped
 */
export function parseToolToObservation(
  toolName: string,
  input: unknown,
  output: unknown,
  toolCallId?: string,
): ParsedObservation | null {
  const base = {
    toolName,
    toolCallId,
    facts: [] as string[],
    concepts: [] as string[],
    filesRead: [] as string[],
    filesModified: [] as string[],
  }

  // Type guard for input object
  const inp = input as Record<string, unknown>

  switch (toolName) {
    case "Read": {
      const filePath = inp.file_path as string
      if (!filePath) return null
      const offset = inp.offset as number | undefined
      const limit = inp.limit as number | undefined
      const narrative = offset || limit
        ? `Read lines ${offset || 0} to ${(offset || 0) + (limit || 100)} from ${filePath}`
        : `Read file ${filePath}`
      return {
        ...base,
        type: "discovery" as ObservationType,
        title: `Read ${getFileName(filePath)}`,
        subtitle: filePath,
        narrative,
        filesRead: [filePath],
        concepts: ["how-it-works"],
      }
    }

    case "Write": {
      const filePath = inp.file_path as string
      if (!filePath) return null
      const content = inp.content as string
      const lineCount = content?.split("\n").length || 0
      return {
        ...base,
        type: "change" as ObservationType,
        title: `Created ${getFileName(filePath)}`,
        subtitle: filePath,
        narrative: `Created new file with ${lineCount} lines`,
        filesModified: [filePath],
        concepts: ["what-changed"],
      }
    }

    case "Edit": {
      const filePath = inp.file_path as string
      if (!filePath) return null
      return {
        ...base,
        type: "change" as ObservationType,
        title: `Modified ${getFileName(filePath)}`,
        subtitle: filePath,
        narrative: extractEditSummary(inp),
        filesModified: [filePath],
        concepts: ["what-changed"],
      }
    }

    case "Bash": {
      const command = inp.command as string
      if (!command) return null
      const cmdType = detectCommandType(command)
      const outputStr =
        typeof output === "string" ? output.slice(0, 500) : null
      return {
        ...base,
        type: cmdType.type as ObservationType,
        title: `Executed: ${command.slice(0, 60)}${command.length > 60 ? "..." : ""}`,
        subtitle: null,
        narrative: outputStr,
        concepts: cmdType.concepts,
      }
    }

    case "Glob": {
      const pattern = inp.pattern as string
      const path = inp.path as string
      const files = Array.isArray(output) ? (output as string[]) : []
      const fileCount = files.length
      const narrative = fileCount > 0
        ? `Found ${fileCount} files: ${files.slice(0, 5).map(f => getFileName(f)).join(", ")}${fileCount > 5 ? "..." : ""}`
        : `Searched for pattern "${pattern}" in ${path || "current directory"}`
      return {
        ...base,
        type: "discovery" as ObservationType,
        title: `Found ${fileCount} files matching pattern`,
        subtitle: pattern || null,
        narrative,
        filesRead: files.slice(0, 20),
        concepts: ["how-it-works"],
      }
    }

    case "Grep": {
      const pattern = inp.pattern as string
      const path = inp.path as string
      const outputMode = inp.output_mode as string
      const narrative = `Searched for "${pattern}" in ${path || "current directory"} (mode: ${outputMode || "files_with_matches"})`
      return {
        ...base,
        type: "discovery" as ObservationType,
        title: `Searched for "${pattern?.slice(0, 40) || "pattern"}"`,
        subtitle: path || "current directory",
        narrative,
        concepts: ["how-it-works"],
      }
    }

    case "WebFetch": {
      const url = inp.url as string
      const outputStr =
        typeof output === "string" ? output.slice(0, 500) : null
      return {
        ...base,
        type: "discovery" as ObservationType,
        title: `Fetched ${url?.slice(0, 60) || "URL"}`,
        subtitle: url || null,
        narrative: outputStr,
        concepts: ["how-it-works"],
      }
    }

    case "WebSearch": {
      const query = inp.query as string
      const outputStr =
        typeof output === "string" ? output.slice(0, 500) : null
      return {
        ...base,
        type: "discovery" as ObservationType,
        title: `Searched: ${query?.slice(0, 50) || "query"}`,
        subtitle: null,
        narrative: outputStr,
        concepts: ["how-it-works"],
      }
    }

    case "Task": {
      const description = inp.description as string
      const subagentType = inp.subagent_type as string
      const prompt = inp.prompt as string
      const narrative = prompt
        ? `Task: ${description}\nPrompt: ${prompt.slice(0, 300)}${prompt.length > 300 ? "..." : ""}`
        : `Task: ${description}`
      return {
        ...base,
        type: "discovery" as ObservationType,
        title: `Agent task: ${description?.slice(0, 50) || "unknown"}`,
        subtitle: subagentType || null,
        narrative,
        concepts: ["how-it-works"],
      }
    }

    case "NotebookEdit": {
      const notebookPath = inp.notebook_path as string
      if (!notebookPath) return null
      const editMode = inp.edit_mode as string
      const cellType = inp.cell_type as string
      const narrative = `${editMode || "edit"} ${cellType || "cell"} in notebook`
      return {
        ...base,
        type: "change" as ObservationType,
        title: `Modified notebook ${getFileName(notebookPath)}`,
        subtitle: notebookPath,
        narrative,
        filesModified: [notebookPath],
        concepts: ["what-changed"],
      }
    }

    default:
      // Skip unknown tools
      return null
  }
}

/**
 * Extract filename from path
 */
function getFileName(filePath: string): string {
  return filePath.split("/").pop() || filePath
}

/**
 * Extract a summary of what was edited
 */
function extractEditSummary(input: Record<string, unknown>): string | null {
  const oldString = input.old_string as string
  const newString = input.new_string as string

  if (!oldString || !newString) return null

  const oldLines = oldString.split("\n").length
  const newLines = newString.split("\n").length
  const diff = newLines - oldLines

  if (diff === 0) {
    return `Changed ${oldLines} line(s)`
  } else if (diff > 0) {
    return `Added ${diff} line(s) (${oldLines} -> ${newLines})`
  } else {
    return `Removed ${Math.abs(diff)} line(s) (${oldLines} -> ${newLines})`
  }
}

/**
 * Detect command type and concepts from bash command
 */
function detectCommandType(command: string): {
  type: string
  concepts: string[]
} {
  const lowerCmd = command.toLowerCase()

  // Git commands
  if (lowerCmd.includes("git")) {
    if (
      lowerCmd.includes("commit") ||
      lowerCmd.includes("push") ||
      lowerCmd.includes("merge")
    ) {
      return { type: "change", concepts: ["what-changed"] }
    }
    return { type: "discovery", concepts: ["how-it-works"] }
  }

  // Package managers
  if (
    lowerCmd.includes("npm") ||
    lowerCmd.includes("bun") ||
    lowerCmd.includes("yarn") ||
    lowerCmd.includes("pnpm")
  ) {
    if (lowerCmd.includes("install") || lowerCmd.includes("add")) {
      return { type: "change", concepts: ["what-changed"] }
    }
    return { type: "discovery", concepts: ["how-it-works"] }
  }

  // Testing
  if (
    lowerCmd.includes("test") ||
    lowerCmd.includes("jest") ||
    lowerCmd.includes("vitest") ||
    lowerCmd.includes("pytest")
  ) {
    return { type: "discovery", concepts: ["testing"] }
  }

  // Build commands
  if (
    lowerCmd.includes("build") ||
    lowerCmd.includes("compile") ||
    lowerCmd.includes("make")
  ) {
    return { type: "change", concepts: ["how-it-works"] }
  }

  // Default
  return { type: "discovery", concepts: ["how-it-works"] }
}

/**
 * Check if this is a meta-observation that should be skipped
 * (e.g., session-memory file operations)
 */
export function isMetaObservation(
  toolName: string,
  toolInput: unknown,
): boolean {
  const fileOps = ["Read", "Write", "Edit", "NotebookEdit"]
  if (!fileOps.includes(toolName)) return false

  const inp = toolInput as Record<string, unknown>
  const filePath = (inp?.file_path || inp?.notebook_path) as string
  if (!filePath) return false

  // Skip session-memory files (borrowed from claude-mem)
  return filePath.includes("session-memory")
}

/**
 * Build searchable text from observation for embeddings
 */
export function buildObservationText(parsed: ParsedObservation): string {
  return [
    parsed.title,
    parsed.subtitle,
    parsed.narrative,
    parsed.facts.join(" "),
    parsed.concepts.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
}

/**
 * Parse assistant text message to generate an observation
 * Captures AI responses for memory
 */
export function parseAssistantMessage(
  text: string,
  messageId?: string,
): ParsedObservation | null {
  // Skip very short messages or empty messages
  if (!text || text.trim().length < 20) return null

  // Skip messages that are just tool-related
  if (text.startsWith("I'll ") && text.length < 100) return null

  // Extract a title from the first line or sentence
  const firstLine = text.split("\n")[0].slice(0, 100)
  const title = firstLine.endsWith(".")
    ? firstLine
    : firstLine.length < 80
      ? firstLine
      : `${firstLine.slice(0, 77)}...`

  // Truncate narrative to reasonable length
  const narrative = text.length > 1000 ? `${text.slice(0, 1000)}...` : text

  return {
    type: "response" as ObservationType,
    title,
    subtitle: null,
    narrative,
    facts: [],
    concepts: ["ai-response"],
    filesRead: [],
    filesModified: [],
    toolName: "assistant",
    toolCallId: messageId,
  }
}
