import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react"
import { useAtom } from "jotai"
import { codeToHtml } from "shiki"
import { Loader2 } from "lucide-react"
import { activeCommentInputAtom, lineSelectionAtom } from "../atoms"
import { CommentIndicator, CommentAddButton } from "./comment-indicator"
import { CommentInputPopup } from "./comment-input-popup"
import { useCommentActions } from "../hooks/use-comment-actions"
import type { ReviewComment } from "../types"
import { cn } from "../../../lib/utils"
import { createLogger } from "../../../lib/logger"

const log = createLogger("codeWithLineNumbers")


interface CodeWithLineNumbersProps {
  /** The code content to display */
  content: string
  /** File name for language detection */
  fileName: string
  /** Chat ID for comment storage */
  chatId: string
  /** File path for comment association */
  filePath: string
  /** Existing comments for this file */
  comments?: ReviewComment[]
  /** Additional class name */
  className?: string
  /** Callback when a comment is added */
  onCommentAdded?: (comment: ReviewComment) => void
}

// Map file extensions to Shiki language identifiers
function getLanguageFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || ""

  const langMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    mjs: "javascript",
    cjs: "javascript",
    // Web
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    vue: "vue",
    svelte: "svelte",
    // Data formats
    json: "json",
    jsonc: "jsonc",
    json5: "json5",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    // Shell/Scripts
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "fish",
    ps1: "powershell",
    bat: "batch",
    cmd: "batch",
    // Python
    py: "python",
    pyw: "python",
    pyi: "python",
    // Other languages
    rb: "ruby",
    php: "php",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    go: "go",
    rs: "rust",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    // Config files
    dockerfile: "dockerfile",
    makefile: "makefile",
    tf: "hcl",
    ini: "ini",
    conf: "ini",
    env: "shell",
    gitignore: "gitignore",
    // Markdown/Docs
    md: "markdown",
    mdx: "mdx",
    // Misc
    diff: "diff",
    patch: "diff",
    log: "log",
    txt: "text",
  }

  // Handle special filenames
  const specialFiles: Record<string, string> = {
    Dockerfile: "dockerfile",
    Makefile: "makefile",
    CMakeLists: "cmake",
    Gemfile: "ruby",
    Rakefile: "ruby",
  }

  const baseName = fileName.split("/").pop() || fileName
  if (specialFiles[baseName]) {
    return specialFiles[baseName]
  }

  return langMap[ext] || "text"
}

/**
 * CodeWithLineNumbers - Code display with line numbers and comment support
 */
export const CodeWithLineNumbers = memo(function CodeWithLineNumbers({
  content,
  fileName,
  chatId,
  filePath,
  comments = [],
  className,
  onCommentAdded,
}: CodeWithLineNumbersProps) {
  const [activeInput, setActiveInput] = useAtom(activeCommentInputAtom)
  const [lineSelection, setLineSelection] = useAtom(lineSelectionAtom)
  const { addComment, closeCommentInput } = useCommentActions(chatId)

  const [highlightedLines, setHighlightedLines] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hoveredLine, setHoveredLine] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStartLine = useRef<number | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  // Split content into lines
  const lines = useMemo(() => content.split("\n"), [content])

  // Highlight code using Shiki
  useEffect(() => {
    let cancelled = false

    async function highlight() {
      setIsLoading(true)

      try {
        const lang = getLanguageFromFileName(fileName)
        // Highlight each line separately to preserve line structure
        const highlighted: string[] = []

        for (const line of lines) {
          try {
            // Use a single space for empty lines to maintain height
            const lineContent = line || " "
            const result = await codeToHtml(lineContent, {
              lang,
              theme: "github-dark-default",
            })
            // Extract just the code content from the HTML
            const codeMatch = result.match(/<code[^>]*>([\s\S]*?)<\/code>/i)
            highlighted.push(codeMatch ? codeMatch[1] : lineContent)
          } catch {
            // Fallback for individual line
            highlighted.push(
              line
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;") || "&nbsp;"
            )
          }
        }

        if (!cancelled) {
          setHighlightedLines(highlighted)
        }
      } catch (err) {
        log.error("Syntax highlighting error:", err)
        if (!cancelled) {
          // Fallback to plain text
          setHighlightedLines(
            lines.map((line) =>
              line
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;") || "&nbsp;"
            )
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    highlight()

    return () => {
      cancelled = true
    }
  }, [content, fileName, lines])

  // Get comment count for a line
  const getCommentCountForLine = useCallback(
    (lineNumber: number) => {
      return comments.filter((c) => {
        const { startLine, endLine } = c.lineRange
        return lineNumber >= startLine && lineNumber <= endLine
      }).length
    },
    [comments]
  )

  // Check if line is in selection
  const isLineInSelection = useCallback(
    (lineNumber: number) => {
      if (!lineSelection || lineSelection.filePath !== filePath) return false
      const min = Math.min(lineSelection.startLine, lineSelection.currentLine)
      const max = Math.max(lineSelection.startLine, lineSelection.currentLine)
      return lineNumber >= min && lineNumber <= max
    },
    [lineSelection, filePath]
  )

  // Handle line hover
  const handleLineMouseEnter = useCallback((lineNumber: number) => {
    if (!isDragging.current) {
      setHoveredLine(lineNumber)
    }
  }, [])

  const handleLineMouseLeave = useCallback(() => {
    if (!isDragging.current) {
      setHoveredLine(null)
    }
  }, [])

  // Handle add comment click (single line)
  const handleAddClick = useCallback(
    (lineNumber: number, event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()

      const lineElement = containerRef.current?.querySelector(
        `[data-line="${lineNumber}"]`
      )
      if (!lineElement) return

      const rect = lineElement.getBoundingClientRect()
      const selectedCode = lines[lineNumber - 1] || ""

      setActiveInput({
        filePath,
        lineRange: {
          startLine: lineNumber,
          endLine: lineNumber,
        },
        selectedCode,
        anchorRect: rect,
        source: "file-preview",
      })
    },
    [filePath, lines, setActiveInput]
  )

  // Handle mouse down for drag selection
  const handleMouseDown = useCallback(
    (lineNumber: number, event: React.MouseEvent) => {
      if (event.button !== 0) return

      event.preventDefault()
      isDragging.current = true
      dragStartLine.current = lineNumber

      setLineSelection({
        filePath,
        startLine: lineNumber,
        currentLine: lineNumber,
      })
    },
    [filePath, setLineSelection]
  )

  // Handle mouse move during drag
  useEffect(() => {
    if (!lineSelection || lineSelection.filePath !== filePath || !isDragging.current) return

    const handleGlobalMouseMove = (event: MouseEvent) => {
      if (!isMountedRef.current) return
      const container = containerRef.current
      if (!container) return

      const lineElements = Array.from(container.querySelectorAll("[data-line]"))
      for (const el of lineElements) {
        const rect = el.getBoundingClientRect()
        if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
          const lineNum = parseInt(el.getAttribute("data-line") || "0", 10)
          if (lineNum > 0) {
            setLineSelection((prev) =>
              prev ? { ...prev, currentLine: lineNum } : null
            )
          }
          break
        }
      }
    }

    const handleGlobalMouseUp = () => {
      if (!isMountedRef.current) return
      if (!isDragging.current || dragStartLine.current === null) return

      isDragging.current = false
      const startLine = lineSelection.startLine
      const endLine = lineSelection.currentLine
      const minLine = Math.min(startLine, endLine)
      const maxLine = Math.max(startLine, endLine)

      // Get selected code
      const selectedCode = lines.slice(minLine - 1, maxLine).join("\n")

      // Get anchor rect
      const lineElement = containerRef.current?.querySelector(
        `[data-line="${minLine}"]`
      )
      if (lineElement) {
        const rect = lineElement.getBoundingClientRect()

        setActiveInput({
          filePath,
          lineRange: {
            startLine: minLine,
            endLine: maxLine,
          },
          selectedCode,
          anchorRect: rect,
          source: "file-preview",
        })
      }

      setLineSelection(null)
      dragStartLine.current = null
    }

    document.addEventListener("mousemove", handleGlobalMouseMove)
    document.addEventListener("mouseup", handleGlobalMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove)
      document.removeEventListener("mouseup", handleGlobalMouseUp)
    }
  }, [lineSelection, filePath, lines, setActiveInput, setLineSelection])

  // Handle comment submission
  const handleSubmitComment = useCallback(
    (body: string) => {
      if (!activeInput || activeInput.filePath !== filePath) return

      const newComment = addComment({
        filePath: activeInput.filePath,
        lineRange: activeInput.lineRange,
        body,
        selectedCode: activeInput.selectedCode,
        source: activeInput.source,
      })

      onCommentAdded?.(newComment)
      closeCommentInput()
    },
    [activeInput, filePath, addComment, closeCommentInput, onCommentAdded]
  )

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "h-full overflow-auto font-mono text-[13px] leading-relaxed select-text",
        className
      )}
    >
      <table className="w-full border-collapse">
        <tbody>
          {highlightedLines.map((lineHtml, index) => {
            const lineNumber = index + 1
            const commentCount = getCommentCountForLine(lineNumber)
            const isHovered = hoveredLine === lineNumber
            const isSelected = isLineInSelection(lineNumber)

            return (
              <tr
                key={lineNumber}
                data-line={lineNumber}
                className={cn(
                  "group/line",
                  isSelected && "bg-blue-500/20"
                )}
                onMouseEnter={() => handleLineMouseEnter(lineNumber)}
                onMouseLeave={handleLineMouseLeave}
              >
                {/* Gutter with line number and comment controls */}
                <td className="relative w-12 text-right pr-3 select-none align-top text-muted-foreground/60 border-r border-border/40">
                  <div className="flex items-center justify-end gap-1 h-full min-h-[1.5em]">
                    {/* Comment indicator */}
                    {commentCount > 0 && (
                      <CommentIndicator count={commentCount} size="sm" />
                    )}

                    {/* Add button (shown on hover when no comments) */}
                    {isHovered && commentCount === 0 && (
                      <CommentAddButton
                        onClick={(e) => handleAddClick(lineNumber, e)}
                        onMouseDown={(e) => handleMouseDown(lineNumber, e)}
                        className="opacity-100"
                      />
                    )}

                    {/* Line number */}
                    <span className="text-xs tabular-nums">{lineNumber}</span>
                  </div>
                </td>

                {/* Code content */}
                <td
                  className="pl-4 whitespace-pre"
                  dangerouslySetInnerHTML={{ __html: lineHtml }}
                />
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Comment input popup */}
      {activeInput && activeInput.filePath === filePath && (
        <CommentInputPopup
          filePath={activeInput.filePath}
          lineRange={activeInput.lineRange}
          anchorRect={activeInput.anchorRect}
          selectedCode={activeInput.selectedCode}
          source={activeInput.source}
          onSubmit={handleSubmitComment}
          onCancel={closeCommentInput}
        />
      )}
    </div>
  )
})
