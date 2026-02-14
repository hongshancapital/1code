import { useEffect, useMemo } from "react"
import { useSetAtom } from "jotai"
import type { Message } from "@ai-sdk/react"
import { pendingPlanApprovalsAtom } from "../atoms"

export interface UsePlanApprovalStateOptions {
  messages: Message[]
  subChatMode: string
  subChatId: string
  parentChatId: string
  isActive: boolean
  isStreaming: boolean
  handleApprovePlan: () => void
  hasUnapprovedPlanRef: React.MutableRefObject<boolean>
}

export interface UsePlanApprovalStateReturn {
  hasUnapprovedPlan: boolean
}

/**
 * Hook to manage plan approval state, sidebar indicators, and keyboard shortcut.
 *
 * Responsibilities:
 * - Compute hasUnapprovedPlan from messages (checks for completed ExitPlanMode)
 * - Sync hasUnapprovedPlanRef for use in layout effects
 * - Update pendingPlanApprovals atom for sidebar indicators
 * - Cmd+Enter keyboard shortcut to approve plan
 */
export function usePlanApprovalState({
  messages,
  subChatMode,
  subChatId,
  parentChatId,
  isActive,
  isStreaming,
  handleApprovePlan,
  hasUnapprovedPlanRef,
}: UsePlanApprovalStateOptions): UsePlanApprovalStateReturn {
  // Check if there's an unapproved plan (in plan mode with completed ExitPlanMode)
  const hasUnapprovedPlan = useMemo(() => {
    // If already in agent mode, plan is approved (mode is the source of truth)
    if (subChatMode !== "plan") return false

    // Look for completed ExitPlanMode in messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]

      // If assistant message with completed ExitPlanMode, we found an unapproved plan
      if (msg.role === "assistant" && msg.parts) {
        const exitPlanPart = msg.parts.find(
          (p: any) => p.type === "tool-ExitPlanMode"
        )
        // Check if ExitPlanMode is completed (has output, even if empty)
        if (exitPlanPart && exitPlanPart.output !== undefined) {
          return true
        }
      }
    }
    return false
  }, [messages, subChatMode])

  // Keep ref in sync for use in initializeScroll (which runs in useLayoutEffect)
  hasUnapprovedPlanRef.current = hasUnapprovedPlan

  // Update pending plan approvals atom for sidebar indicators
  const setPendingPlanApprovals = useSetAtom(pendingPlanApprovalsAtom)
  useEffect(() => {
    setPendingPlanApprovals((prev: Map<string, string>) => {
      const newMap = new Map(prev)
      if (hasUnapprovedPlan) {
        newMap.set(subChatId, parentChatId)
      } else {
        newMap.delete(subChatId)
      }
      // Only return new map if it changed
      if (newMap.size !== prev.size || ![...newMap.keys()].every((id) => prev.has(id))) {
        return newMap
      }
      return prev
    })
  }, [hasUnapprovedPlan, subChatId, parentChatId, setPendingPlanApprovals])

  // Keyboard shortcut: Cmd+Enter to approve plan
  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Enter" &&
        e.metaKey &&
        !e.shiftKey &&
        hasUnapprovedPlan &&
        !isStreaming
      ) {
        e.preventDefault()
        handleApprovePlan()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isActive, hasUnapprovedPlan, isStreaming, handleApprovePlan])

  return { hasUnapprovedPlan }
}
