// ============================================================================
// Comment 来源类型
// ============================================================================

/** Comment 来源 */
export type CommentSource =
  | "diff-view" // Diff View 中的 comment
  | "file-preview" // 文件预览中的 comment
  | "github-pr" // 来自 GitHub PR 的 comment（未来）

/** Comment 状态 */
export type CommentStatus =
  | "pending" // 待提交给 AI
  | "submitted" // 已提交给 AI

// ============================================================================
// 行范围定义
// ============================================================================

/** 行范围（统一结构） */
export interface LineRange {
  startLine: number // 1-based
  endLine: number // 1-based，单行时等于 startLine
  /** 仅 diff-view 使用，file-preview 时为 undefined */
  side?: "old" | "new"
}

// ============================================================================
// 用户 Comment（本地创建，提交给 AI）
// ============================================================================

/** 用户创建的 Review Comment */
export interface ReviewComment {
  id: string
  filePath: string
  lineRange: LineRange
  body: string
  /** 选中行的代码内容 */
  selectedCode?: string
  source: CommentSource
  status: CommentStatus
  createdAt: number
  /** 标记是否为 context comment（来自 chat input 添加的 comment） */
  isContextComment?: boolean
  /** 标记是否为 review comment（来自 ReviewPanel 添加的 comment） */
  isReviewComment?: boolean
}

// ============================================================================
// GitHub PR Comment（未来功能，预留结构）
// ============================================================================

/** GitHub 用户信息 */
export interface GitHubUser {
  login: string
  avatarUrl: string
}

/** 来自 GitHub PR 的 Comment */
export interface GitHubPRComment {
  id: string
  /** GitHub comment ID */
  githubId: number
  filePath: string
  lineRange: LineRange
  body: string

  /** GitHub 用户信息 */
  author: GitHubUser

  /** 时间戳 (ISO 8601) */
  createdAt: string
  updatedAt: string

  /** PR 关联 */
  pullRequestNumber: number
  /** 关联的 commit SHA */
  commitId?: string

  /** 状态 */
  isResolved: boolean
  /** 代码已变更，comment 可能过时 */
  isOutdated: boolean

  /** 回复链（Thread 结构） */
  /** 父 comment 的 GitHub ID */
  inReplyToId?: number
  /** 子 replies */
  replies?: GitHubPRComment[]
}

// ============================================================================
// Comment Thread（一组关联的 comments）
// ============================================================================

/** Comment Thread - 支持混合本地和 GitHub PR comments */
export interface CommentThread {
  id: string
  filePath: string
  lineRange: LineRange

  /** 混合类型：可以是用户 comment 也可以是 GitHub PR comment */
  comments: Array<ReviewComment | GitHubPRComment>

  /** Thread 来源 */
  source: "local" | "github-pr"
  isResolved: boolean
}

// ============================================================================
// Type Guards
// ============================================================================

/** 判断是否为 GitHub PR Comment */
export function isGitHubPRComment(
  comment: ReviewComment | GitHubPRComment
): comment is GitHubPRComment {
  return "githubId" in comment
}

/** 判断是否为本地 Review Comment */
export function isReviewComment(
  comment: ReviewComment | GitHubPRComment
): comment is ReviewComment {
  return !("githubId" in comment)
}

// ============================================================================
// UI State Types
// ============================================================================

/** 当前活跃的 comment 输入框状态 */
export interface ActiveCommentInput {
  filePath: string
  lineRange: LineRange
  /** 选中的代码内容 */
  selectedCode?: string
  /** 用于定位浮动框的锚点矩形 */
  anchorRect: DOMRect
  /** 来源 */
  source: CommentSource
}

/** 行选择状态（拖拽选择多行时） */
export interface LineSelectionState {
  filePath: string
  startLine: number
  currentLine: number
  side?: "old" | "new"
}
