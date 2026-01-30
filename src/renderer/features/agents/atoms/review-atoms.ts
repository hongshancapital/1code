import { atom } from "jotai"
import { atomFamily, atomWithStorage } from "jotai/utils"
import { nanoid } from "nanoid"

// ============ Types ============

export type DocumentType = "plan" | "diff" | "tool-edit"

export interface CommentAnchor {
  // Line information - for AI message format (filePath:L12-34)
  lineStart?: number
  lineEnd?: number
  lineType?: "old" | "new" // for diff

  // Character position - for rendering highlight
  charStart?: number      // character offset from start of document/line
  charLength?: number     // length of selected text

  // Selected text content
  selectedText: string
  textHash: string // for detecting content changes
}

export interface DocumentComment {
  id: string
  documentType: DocumentType
  documentPath: string
  anchor: CommentAnchor
  content: string
  createdAt: string // ISO string for JSON serialization
  updatedAt: string
}

// ============ Helpers ============

// Simple hash function for text content
export function hashText(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

export function generateCommentId(): string {
  return nanoid(10)
}

// ============ Storage Atoms ============

// Review comments storage - stores all comments keyed by chatId
// Using localStorage persistence
const reviewCommentsStorageAtom = atomWithStorage<Record<string, DocumentComment[]>>(
  "agents:reviewComments",
  {},
  undefined,
  { getOnInit: true }
)

// Review panel open state storage - keyed by chatId
const reviewPanelOpenStorageAtom = atom<Record<string, boolean>>({})

// ============ atomFamily Exports ============

/**
 * atomFamily to get/set review comments per subChatId
 * Persisted to localStorage so users can resume editing
 *
 * Note: Changed from chatId to subChatId because:
 * - Plan content is associated with a specific subChat
 * - Different subChats in the same chat may have different plans
 * - Comments should be isolated per subChat context
 */
export const reviewCommentsAtomFamily = atomFamily((subChatId: string) =>
  atom(
    (get) => get(reviewCommentsStorageAtom)[subChatId] ?? [],
    (get, set, comments: DocumentComment[]) => {
      const current = get(reviewCommentsStorageAtom)
      set(reviewCommentsStorageAtom, { ...current, [subChatId]: comments })
    }
  )
)

/**
 * atomFamily to get/set review panel open state per subChatId
 * Not persisted - resets on reload
 */
export const reviewPanelOpenAtomFamily = atomFamily((subChatId: string) =>
  atom(
    (get) => get(reviewPanelOpenStorageAtom)[subChatId] ?? false,
    (get, set, isOpen: boolean) => {
      const current = get(reviewPanelOpenStorageAtom)
      set(reviewPanelOpenStorageAtom, { ...current, [subChatId]: isOpen })
    }
  )
)

// ============ Global Atoms ============

/**
 * Currently editing comment ID - used for edit mode
 * null means not editing any comment
 */
export const editingCommentIdAtom = atom<string | null>(null)

/**
 * Comment input state - tracks which comment input is open and its position
 */
export interface CommentInputState {
  selectedText: string
  documentType: DocumentType
  documentPath: string
  // Line information
  lineStart?: number
  lineEnd?: number
  lineType?: "old" | "new"
  // Character position for highlight rendering
  charStart?: number
  charLength?: number
  // UI positioning
  rect: DOMRect
  existingCommentId?: string // for edit mode
}

/**
 * Format line range for AI message (e.g., "L12" or "L12-34")
 */
export function formatLineRange(lineStart?: number, lineEnd?: number): string {
  if (!lineStart) return ""
  if (!lineEnd || lineEnd === lineStart) return `L${lineStart}`
  return `L${lineStart}-${lineEnd}`
}

/**
 * Format file path with line range for AI message (e.g., "src/file.ts:L12-34")
 */
export function formatFilePathWithLines(
  filePath: string,
  lineStart?: number,
  lineEnd?: number
): string {
  const fileName = filePath.split("/").pop() || filePath
  const lineRange = formatLineRange(lineStart, lineEnd)
  return lineRange ? `${fileName}:${lineRange}` : fileName
}

export const commentInputStateAtom = atom<CommentInputState | null>(null)
