/**
 * Observation Parser
 * Rule-based parser for generating observations from tool calls.
 * Classifies into 10 types with confidence scores.
 * Low-confidence results trigger LLM enhancement in summarizer.ts.
 */

import type { ParsedObservation, ObservationType } from "./types"

// ============ Content-based classification helpers ============

/** Keywords that suggest bug-fixing activity */
const FIX_KEYWORDS = /\b(fix|bug|error|issue|broken|crash|fail|wrong|patch|hotfix|resolve|debug|修复|修正|报错|崩溃)\b/i

/** Keywords that suggest new feature implementation */
const IMPLEMENT_KEYWORDS = /\b(add|create|implement|new feature|introduce|support|enable|功能|新增|实现|添加)\b/i

/** Keywords that suggest refactoring */
const REFACTOR_KEYWORDS = /\b(refactor|restructure|reorganize|clean\s?up|simplify|extract|rename|move|split|merge|重构|优化|整理)\b/i

/** Keywords that suggest documentation/writing */
const COMPOSE_KEYWORDS = /\b(doc|readme|changelog|comment|translate|写|翻译|文档|说明)\b/i

/** Keywords that suggest analysis */
const ANALYZE_KEYWORDS = /\b(analyz|profil|benchmark|measur|compar|review|audit|inspect|evaluat|分析|评估|对比|审查|检查)\b/i

/** Keywords that suggest a decision */
const DECISION_KEYWORDS = /\b(decid|choos|pick|select|prefer|approach|strategy|option|architect|决定|选择|方案|架构)\b/i

/** File extensions that indicate documentation/writing */
const DOC_EXTENSIONS = /\.(md|mdx|txt|rst|adoc|docx|pdf|tex|翻译)$/i

/** File extensions that indicate data/analysis */
const DATA_EXTENSIONS = /\.(csv|tsv|json|xlsx|xls|sql|ipynb|parquet)$/i

/**
 * Parse tool output to generate an observation with confidence score.
 * Returns null for tools that should be skipped entirely.
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

      // Classify: reading docs = research, reading data = analyze, reading code = explore
      const { type, concepts, confidence } = classifyReadFile(filePath)

      return {
        ...base,
        type,
        title: `Read ${getFileName(filePath)}`,
        subtitle: filePath,
        narrative,
        filesRead: [filePath],
        concepts,
        confidence,
      }
    }

    case "Write": {
      const filePath = inp.file_path as string
      if (!filePath) return null
      const content = inp.content as string
      const lineCount = content?.split("\n").length || 0

      // Classify based on file type and content
      const { type, concepts, confidence } = classifyWriteFile(filePath, content)

      return {
        ...base,
        type,
        title: `Created ${getFileName(filePath)}`,
        subtitle: filePath,
        narrative: `Created new file with ${lineCount} lines`,
        filesModified: [filePath],
        concepts,
        confidence,
      }
    }

    case "Edit": {
      const filePath = inp.file_path as string
      if (!filePath) return null
      const oldString = inp.old_string as string
      const newString = inp.new_string as string

      // Classify based on edit content
      const { type, concepts, confidence } = classifyEdit(filePath, oldString, newString)

      return {
        ...base,
        type,
        title: `Modified ${getFileName(filePath)}`,
        subtitle: filePath,
        narrative: extractEditSummary(inp),
        filesModified: [filePath],
        concepts,
        confidence,
      }
    }

    case "Bash": {
      const command = inp.command as string
      if (!command) return null
      const outputStr =
        typeof output === "string" ? output.slice(0, 500) : null

      const { type, concepts, confidence } = classifyBashCommand(command, outputStr)

      return {
        ...base,
        type,
        title: `Executed: ${command.slice(0, 60)}${command.length > 60 ? "..." : ""}`,
        subtitle: null,
        narrative: outputStr,
        concepts,
        confidence,
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
        type: "explore" as ObservationType,
        title: `Found ${fileCount} files matching pattern`,
        subtitle: pattern || null,
        narrative,
        filesRead: files.slice(0, 20),
        concepts: ["how-it-works"],
        confidence: 0.9, // Glob is always exploration
      }
    }

    case "Grep": {
      const pattern = inp.pattern as string
      const path = inp.path as string
      const outputMode = inp.output_mode as string
      const narrative = `Searched for "${pattern}" in ${path || "current directory"} (mode: ${outputMode || "files_with_matches"})`
      return {
        ...base,
        type: "explore" as ObservationType,
        title: `Searched for "${pattern?.slice(0, 40) || "pattern"}"`,
        subtitle: path || "current directory",
        narrative,
        concepts: ["how-it-works"],
        confidence: 0.9,
      }
    }

    case "WebFetch": {
      const url = inp.url as string
      const outputStr =
        typeof output === "string" ? output.slice(0, 500) : null
      return {
        ...base,
        type: "research" as ObservationType,
        title: `Fetched ${url?.slice(0, 60) || "URL"}`,
        subtitle: url || null,
        narrative: outputStr,
        concepts: ["how-it-works"],
        confidence: 0.85,
      }
    }

    case "WebSearch": {
      const query = inp.query as string
      const outputStr =
        typeof output === "string" ? output.slice(0, 500) : null
      return {
        ...base,
        type: "research" as ObservationType,
        title: `Searched: ${query?.slice(0, 50) || "query"}`,
        subtitle: null,
        narrative: outputStr,
        concepts: ["how-it-works"],
        confidence: 0.9,
      }
    }

    case "Task": {
      const description = inp.description as string
      const subagentType = inp.subagent_type as string
      const prompt = inp.prompt as string
      const narrative = prompt
        ? `Task: ${description}\nPrompt: ${prompt.slice(0, 300)}${prompt.length > 300 ? "..." : ""}`
        : `Task: ${description}`

      // Sub-agent tasks are usually exploration/research, but could be anything
      const type = subagentType === "Explore" ? "explore" as ObservationType : "research" as ObservationType
      return {
        ...base,
        type,
        title: `Agent task: ${description?.slice(0, 50) || "unknown"}`,
        subtitle: subagentType || null,
        narrative,
        concepts: ["how-it-works"],
        confidence: 0.5, // Sub-agent tasks are ambiguous, LLM should classify
      }
    }

    case "NotebookEdit": {
      const notebookPath = inp.notebook_path as string
      if (!notebookPath) return null
      const editMode = inp.edit_mode as string
      const cellType = inp.cell_type as string
      const narrative = `${editMode || "edit"} ${cellType || "cell"} in notebook`

      // Notebooks are often analysis, but could be implementation
      const type = cellType === "markdown" ? "compose" as ObservationType : "analyze" as ObservationType
      return {
        ...base,
        type,
        title: `Modified notebook ${getFileName(notebookPath)}`,
        subtitle: notebookPath,
        narrative,
        filesModified: [notebookPath],
        concepts: cellType === "markdown" ? ["documentation"] : ["data-insight"],
        confidence: 0.6, // Notebooks are ambiguous
      }
    }

    default:
      // Unknown tools — don't skip, classify as explore with low confidence
      // so LLM can decide
      if (hasSubstantialOutput(output)) {
        const outputStr = typeof output === "string" ? output.slice(0, 500) : JSON.stringify(output).slice(0, 500)
        return {
          ...base,
          type: "explore" as ObservationType,
          title: `Used ${toolName}`,
          subtitle: null,
          narrative: outputStr,
          concepts: [],
          confidence: 0.3, // Unknown tool, let LLM classify
        }
      }
      return null
  }
}

// ============ Classification functions ============

function classifyReadFile(filePath: string): {
  type: ObservationType
  concepts: string[]
  confidence: number
} {
  if (DOC_EXTENSIONS.test(filePath)) {
    return { type: "research", concepts: ["documentation"], confidence: 0.85 }
  }
  if (DATA_EXTENSIONS.test(filePath)) {
    return { type: "analyze", concepts: ["data-insight"], confidence: 0.8 }
  }
  // Reading code files — this is exploration
  return { type: "explore", concepts: ["how-it-works"], confidence: 0.85 }
}

function classifyWriteFile(filePath: string, content: string | undefined): {
  type: ObservationType
  concepts: string[]
  confidence: number
} {
  // Documentation files
  if (DOC_EXTENSIONS.test(filePath)) {
    return { type: "compose", concepts: ["documentation"], confidence: 0.9 }
  }
  // Data files
  if (DATA_EXTENSIONS.test(filePath)) {
    return { type: "analyze", concepts: ["data-insight"], confidence: 0.8 }
  }
  // Test files
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath) || filePath.includes("__tests__")) {
    return { type: "implement", concepts: ["testing"], confidence: 0.85 }
  }

  // Check content for more signals if available
  if (content) {
    if (FIX_KEYWORDS.test(content.slice(0, 500))) {
      return { type: "fix", concepts: ["problem-solution"], confidence: 0.5 }
    }
  }

  // Default: creating a new code file is usually implementing
  return { type: "implement", concepts: ["what-changed"], confidence: 0.7 }
}

function classifyEdit(
  filePath: string,
  oldString: string | undefined,
  newString: string | undefined,
): {
  type: ObservationType
  concepts: string[]
  confidence: number
} {
  // Documentation edits
  if (DOC_EXTENSIONS.test(filePath)) {
    return { type: "compose", concepts: ["documentation"], confidence: 0.9 }
  }

  // If we have the edit content, look at what changed
  if (oldString && newString) {
    const combined = `${oldString} ${newString}`

    // Fix patterns: error handling, bug-related changes
    if (FIX_KEYWORDS.test(combined)) {
      return { type: "fix", concepts: ["problem-solution"], confidence: 0.6 }
    }
    // Refactor patterns: renaming, restructuring
    if (REFACTOR_KEYWORDS.test(combined)) {
      return { type: "refactor", concepts: ["pattern"], confidence: 0.6 }
    }
    // New feature patterns
    if (IMPLEMENT_KEYWORDS.test(combined)) {
      return { type: "implement", concepts: ["what-changed"], confidence: 0.5 }
    }

    // Small edits (< 5 lines changed) are likely minor edits
    const oldLines = oldString.split("\n").length
    const newLines = newString.split("\n").length
    if (Math.abs(newLines - oldLines) < 3 && oldLines < 5) {
      return { type: "edit", concepts: ["what-changed"], confidence: 0.8 }
    }

    // Large edits are ambiguous — could be refactor, feature, or fix
    return { type: "edit", concepts: ["what-changed"], confidence: 0.4 }
  }

  // No edit content available
  return { type: "edit", concepts: ["what-changed"], confidence: 0.5 }
}

function classifyBashCommand(command: string, output: string | null): {
  type: ObservationType
  concepts: string[]
  confidence: number
} {
  const cmd = command.toLowerCase()
  const _combined = output ? `${cmd} ${output.toLowerCase()}` : cmd

  // Git operations
  if (cmd.includes("git")) {
    if (cmd.includes("commit") || cmd.includes("push") || cmd.includes("merge")) {
      return { type: "edit", concepts: ["what-changed"], confidence: 0.9 }
    }
    if (cmd.includes("log") || cmd.includes("diff") || cmd.includes("status") || cmd.includes("branch")) {
      return { type: "explore", concepts: ["how-it-works"], confidence: 0.9 }
    }
    return { type: "explore", concepts: ["how-it-works"], confidence: 0.7 }
  }

  // Testing
  if (/\b(test|jest|vitest|pytest|mocha|karma|cypress|playwright)\b/.test(cmd)) {
    return { type: "analyze", concepts: ["testing"], confidence: 0.9 }
  }

  // Linting / type checking
  if (/\b(lint|eslint|tsc|typecheck|prettier|biome)\b/.test(cmd)) {
    return { type: "analyze", concepts: ["testing"], confidence: 0.85 }
  }

  // Build / compile
  if (/\b(build|compile|make|webpack|vite|esbuild|tsc)\b/.test(cmd)) {
    return { type: "analyze", concepts: ["how-it-works"], confidence: 0.8 }
  }

  // Package managers — install
  if (/\b(npm|bun|yarn|pnpm|pip|cargo|brew)\b/.test(cmd)) {
    if (/\b(install|add|i\s)\b/.test(cmd)) {
      return { type: "edit", concepts: ["what-changed"], confidence: 0.85 }
    }
    if (/\b(run|exec|start|dev)\b/.test(cmd)) {
      return { type: "analyze", concepts: ["how-it-works"], confidence: 0.7 }
    }
    return { type: "explore", concepts: ["how-it-works"], confidence: 0.7 }
  }

  // Docker / infrastructure
  if (/\b(docker|kubectl|terraform|aws|gcloud)\b/.test(cmd)) {
    return { type: "edit", concepts: ["workflow"], confidence: 0.6 }
  }

  // Curl / http — research
  if (/\b(curl|wget|http|fetch)\b/.test(cmd)) {
    return { type: "research", concepts: ["api"], confidence: 0.8 }
  }

  // Analysis tools
  if (/\b(wc|du|df|top|htop|ps|time|perf|strace)\b/.test(cmd)) {
    return { type: "analyze", concepts: ["performance"], confidence: 0.8 }
  }

  // Check output for error signals — could be debugging/fixing
  if (output && /\b(error|fail|exception|traceback|panic)\b/i.test(output)) {
    return { type: "fix", concepts: ["problem-solution"], confidence: 0.4 }
  }

  // Generic command — ambiguous
  return { type: "explore", concepts: ["how-it-works"], confidence: 0.5 }
}

// ============ Helpers ============

function getFileName(filePath: string): string {
  return filePath.split("/").pop() || filePath
}

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

function hasSubstantialOutput(output: unknown): boolean {
  if (!output) return false
  const str = typeof output === "string" ? output : JSON.stringify(output)
  return str.length > 50
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
 * Parse assistant text message to generate an observation.
 * Only captures substantial AI responses that contain real insight.
 */
export function parseAssistantMessage(
  text: string,
  messageId?: string,
): ParsedObservation | null {
  // Skip very short messages or empty messages
  if (!text || text.trim().length < 100) return null

  // Skip messages that are just tool-related filler
  if (text.startsWith("I'll ") && text.length < 200) return null
  if (text.startsWith("Let me ") && text.length < 200) return null
  if (text.startsWith("Now ") && text.length < 200) return null

  // Skip messages that are mostly code blocks (low insight density)
  const textWithoutCode = text.replace(/```[\s\S]*?```/g, "")
  if (textWithoutCode.trim().length < 80) return null

  // Skip messages that look like status updates
  const statusPatterns = [
    /^(好的|好|OK|Done|完成|继续)/i,
    /^(Looking at|Reading|Searching|Checking)/i,
    /^(查看|读取|搜索|检查)/i,
  ]
  if (statusPatterns.some((p) => p.test(text.trim()))) return null

  // Extract a title from the first meaningful line
  const firstLine = text.split("\n")[0].replace(/^#+\s*/, "").slice(0, 100)
  const title = firstLine.endsWith(".")
    ? firstLine
    : firstLine.length < 80
      ? firstLine
      : `${firstLine.slice(0, 77)}...`

  // Truncate narrative — keep only the non-code text for embedding quality
  const narrative = textWithoutCode.length > 500
    ? `${textWithoutCode.slice(0, 500)}...`
    : textWithoutCode

  // Try to detect the nature of the response
  let type: ObservationType = "conversation"
  let concepts: string[] = []
  let confidence = 0.6

  if (DECISION_KEYWORDS.test(textWithoutCode)) {
    type = "decision"
    concepts = ["trade-off"]
    confidence = 0.5 // Decision detection is often ambiguous
  } else if (ANALYZE_KEYWORDS.test(textWithoutCode)) {
    type = "analyze"
    concepts = ["how-it-works"]
    confidence = 0.5
  } else if (COMPOSE_KEYWORDS.test(textWithoutCode)) {
    type = "compose"
    concepts = ["documentation"]
    confidence = 0.5
  } else {
    concepts = ["how-it-works"]
    confidence = 0.7 // Default conversation is fairly certain
  }

  return {
    type,
    title,
    subtitle: null,
    narrative,
    facts: [],
    concepts,
    filesRead: [],
    filesModified: [],
    toolName: "assistant",
    toolCallId: messageId,
    confidence,
  }
}
