// Types
export type {
  CommentSource,
  CommentStatus,
  LineRange,
  ReviewComment,
  GitHubPRComment,
  GitHubUser,
  CommentThread,
  ActiveCommentInput,
  LineSelectionState,
} from "./types"

export { isGitHubPRComment, isReviewComment } from "./types"

// Atoms
export {
  pendingCommentsAtomFamily,
  activeCommentInputAtom,
  lineSelectionAtom,
  commentsPanelOpenAtom,
  fileCommentCountsAtomFamily,
  totalPendingCommentsCountAtomFamily,
  fileCommentsAtomFamily,
  hasCommentOnLine,
  getCommentCountOnLine,
  getCommentsInRange,
} from "./atoms"

// Hooks
export { useCommentActions } from "./hooks"

// Components
export {
  CommentInputPopup,
  CommentIndicator,
  CommentAddButton,
  CommentGutterLayer,
  CommentsSummaryPanel,
  CodeWithLineNumbers,
} from "./components"

// Utils
export {
  formatCommentsForAI,
  formatCommentSummary,
  estimateTokenCount,
  isCommentsTooLong,
  MAX_RECOMMENDED_TOKENS,
} from "./utils"
