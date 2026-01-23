import { atom } from "jotai"
import { atomFamily, atomWithStorage } from "jotai/utils"
import type {
  ReviewComment,
  ActiveCommentInput,
  LineSelectionState,
} from "./types"

// ============================================================================
// Pending Comments 持久化存储
// ============================================================================

/**
 * 所有 pending comments 的底层存储（持久化到 localStorage）
 * 结构: { [chatId]: ReviewComment[] }
 *
 * 重要：在 Submit 之前必须持久化，避免刷新页面丢失用户的 review 工作
 */
const allPendingCommentsStorageAtom = atomWithStorage<
  Record<string, ReviewComment[]>
>(
  "review-comments:pending", // localStorage key
  {},
  undefined,
  { getOnInit: true } // 页面加载时立即从 localStorage 恢复
)

/**
 * atomFamily 获取每个 chatId 的 pending comments
 * 支持函数式更新: setComments(prev => [...prev, newComment])
 */
export const pendingCommentsAtomFamily = atomFamily((chatId: string) =>
  atom(
    (get) => get(allPendingCommentsStorageAtom)[chatId] ?? [],
    (
      get,
      set,
      update: ReviewComment[] | ((prev: ReviewComment[]) => ReviewComment[])
    ) => {
      const current = get(allPendingCommentsStorageAtom)
      const prevComments = current[chatId] ?? []
      const newComments =
        typeof update === "function" ? update(prevComments) : update
      // 每次更新都会自动持久化到 localStorage
      set(allPendingCommentsStorageAtom, { ...current, [chatId]: newComments })
    }
  )
)

// ============================================================================
// UI 状态（不需要持久化）
// ============================================================================

/** 当前活跃的 comment 输入框 */
export const activeCommentInputAtom = atom<ActiveCommentInput | null>(null)

/** 行选择状态（拖拽选择多行时） */
export const lineSelectionAtom = atom<LineSelectionState | null>(null)

/** Comments 汇总面板开关 */
export const commentsPanelOpenAtom = atom<boolean>(false)

// ============================================================================
// 派生状态
// ============================================================================

/**
 * 每个文件的 pending comments 数量
 * 返回 { [filePath]: count }
 */
export const fileCommentCountsAtomFamily = atomFamily((chatId: string) =>
  atom((get) => {
    const comments = get(pendingCommentsAtomFamily(chatId))
    const counts: Record<string, number> = {}
    for (const comment of comments) {
      counts[comment.filePath] = (counts[comment.filePath] ?? 0) + 1
    }
    return counts
  })
)

/**
 * 总 pending comments 数量
 */
export const totalPendingCommentsCountAtomFamily = atomFamily((chatId: string) =>
  atom((get) => get(pendingCommentsAtomFamily(chatId)).length)
)

/**
 * 获取指定文件的 comments
 */
export const fileCommentsAtomFamily = atomFamily(
  ({ chatId, filePath }: { chatId: string; filePath: string }) =>
    atom((get) => {
      const comments = get(pendingCommentsAtomFamily(chatId))
      return comments.filter((c) => c.filePath === filePath)
    })
)

/**
 * 检查指定行是否有 comment
 */
export function hasCommentOnLine(
  comments: ReviewComment[],
  lineNumber: number,
  side?: "old" | "new"
): boolean {
  return comments.some((comment) => {
    const { startLine, endLine, side: commentSide } = comment.lineRange
    const lineInRange = lineNumber >= startLine && lineNumber <= endLine
    // 如果指定了 side，需要匹配
    if (side && commentSide) {
      return lineInRange && commentSide === side
    }
    return lineInRange
  })
}

/**
 * 获取指定行的 comment 数量
 */
export function getCommentCountOnLine(
  comments: ReviewComment[],
  lineNumber: number,
  side?: "old" | "new"
): number {
  return comments.filter((comment) => {
    const { startLine, endLine, side: commentSide } = comment.lineRange
    const lineInRange = lineNumber >= startLine && lineNumber <= endLine
    if (side && commentSide) {
      return lineInRange && commentSide === side
    }
    return lineInRange
  }).length
}

/**
 * 获取指定行范围内的 comments
 */
export function getCommentsInRange(
  comments: ReviewComment[],
  startLine: number,
  endLine: number,
  side?: "old" | "new"
): ReviewComment[] {
  return comments.filter((comment) => {
    const {
      startLine: cStart,
      endLine: cEnd,
      side: commentSide,
    } = comment.lineRange
    // 检查范围是否有重叠
    const hasOverlap = cStart <= endLine && cEnd >= startLine
    if (side && commentSide) {
      return hasOverlap && commentSide === side
    }
    return hasOverlap
  })
}
