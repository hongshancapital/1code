import type { ReviewComment } from "../types"

/**
 * Group comments by file path
 */
function groupByFile(comments: ReviewComment[]): Record<string, ReviewComment[]> {
  const groups: Record<string, ReviewComment[]> = {}
  for (const comment of comments) {
    if (!groups[comment.filePath]) {
      groups[comment.filePath] = []
    }
    groups[comment.filePath].push(comment)
  }
  return groups
}

/**
 * Get file language for code fence based on file extension
 */
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || ""
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    bash: "bash",
  }
  return langMap[ext] || ""
}

/**
 * Format a line range for display
 */
function formatLineRange(startLine: number, endLine: number, side?: "old" | "new"): string {
  const lineDesc =
    startLine === endLine
      ? `Line ${startLine}`
      : `Lines ${startLine}-${endLine}`

  if (side) {
    return `${lineDesc} (${side === "old" ? "before" : "after"})`
  }
  return lineDesc
}

/**
 * Format source type for display
 */
function formatSource(source: string): string {
  switch (source) {
    case "diff-view":
      return "Diff"
    case "file-preview":
      return "File"
    default:
      return source
  }
}

/**
 * Format comments for submission to AI
 *
 * Creates a structured markdown message that AI can parse to understand:
 * - Which files have comments
 * - What lines are being referenced
 * - The actual code being commented on (if available)
 * - The user's feedback/request
 */
export function formatCommentsForAI(comments: ReviewComment[]): string {
  if (comments.length === 0) return ""

  const byFile = groupByFile(comments)
  const fileCount = Object.keys(byFile).length
  const commentCount = comments.length

  let message = "## Code Review Comments\n\n"
  message += `I have ${commentCount} review comment${commentCount !== 1 ? "s" : ""} `
  message += `on ${fileCount} file${fileCount !== 1 ? "s" : ""}. `
  message += "Please address these comments and make the necessary changes:\n\n"

  for (const [filePath, fileComments] of Object.entries(byFile)) {
    const lang = getLanguageFromPath(filePath)

    message += `### ${filePath}\n\n`

    // Sort comments by line number
    const sortedComments = [...fileComments].sort(
      (a, b) => a.lineRange.startLine - b.lineRange.startLine
    )

    for (const comment of sortedComments) {
      const { startLine, endLine, side } = comment.lineRange
      const lineDesc = formatLineRange(startLine, endLine, side)
      const sourceLabel = formatSource(comment.source)

      message += `**${lineDesc}** _(${sourceLabel})_:\n`

      // Include selected code if available
      if (comment.selectedCode) {
        message += "```" + lang + "\n"
        message += comment.selectedCode + "\n"
        message += "```\n"
      }

      message += `> ${comment.body}\n\n`
    }
  }

  return message.trim()
}

/**
 * Format a single comment for quick display (e.g., in summary panel)
 */
export function formatCommentSummary(comment: ReviewComment): string {
  const fileName = comment.filePath.split("/").pop() || comment.filePath
  const { startLine, endLine } = comment.lineRange
  const lineDesc =
    startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`

  return `${fileName}:${lineDesc}`
}

/**
 * Check if comments message exceeds a reasonable length
 * (AI has token limits, so we might want to warn users)
 */
export function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4)
}

export const MAX_RECOMMENDED_TOKENS = 8000

export function isCommentsTooLong(comments: ReviewComment[]): boolean {
  const formatted = formatCommentsForAI(comments)
  return estimateTokenCount(formatted) > MAX_RECOMMENDED_TOKENS
}
