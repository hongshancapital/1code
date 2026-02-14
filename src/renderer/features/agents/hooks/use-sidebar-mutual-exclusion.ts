/**
 * useSidebarMutualExclusion - Manages mutual exclusion between sidebars
 *
 * Extracted from active-chat.tsx to improve maintainability.
 * Handles the logic where certain sidebars conflict with each other:
 * - Details sidebar conflicts with Plan, Terminal (side-peek mode), and Diff (side-peek mode)
 * - When one opens, it closes conflicting sidebars and remembers for restoration
 * - Diff sidebar has special behavior: when opened while Details is open, it switches to center-peek mode
 */

import { useEffect, useRef } from "react"

export interface SidebarMutualExclusionState {
  isDetailsSidebarOpen: boolean
  isPlanSidebarOpen: boolean
  currentPlanPath: string | null
  isTerminalSidebarOpen: boolean
  terminalDisplayMode: "side-peek" | "bottom"
  // Diff sidebar state (optional - only needed if handling Diff)
  isDiffSidebarOpen?: boolean
  diffDisplayMode?: "side-peek" | "center-peek" | "full-page"
}

export interface SidebarMutualExclusionSetters {
  setIsDetailsSidebarOpen: (value: boolean) => void
  setIsPlanSidebarOpen: (value: boolean) => void
  setIsTerminalSidebarOpen: (value: boolean) => void
  // Diff sidebar setters (optional)
  setIsDiffSidebarOpen?: (value: boolean) => void
  setDiffDisplayMode?: (value: "side-peek" | "center-peek" | "full-page") => void
}

interface AutoClosedState {
  // What closed Details
  detailsClosedBy: "plan" | "terminal" | "diff" | null
  // What Details closed
  planClosedByDetails: boolean
  terminalClosedByDetails: boolean
  diffClosedByDetails: boolean
}

interface PrevSidebarStates {
  details: boolean
  planSidebarOpen: boolean
  planHasPath: boolean
  terminal: boolean
  diff: boolean
  diffMode: string
}

/**
 * Hook to manage mutual exclusion between sidebars
 *
 * Behavior:
 * - When Details opens: closes Plan, Terminal (side-peek), and Diff (side-peek), remembers for restoration
 * - When Details closes: restores Plan/Terminal/Diff if they were auto-closed
 * - When Plan opens: closes Details, remembers for restoration
 * - When Plan closes: restores Details if it was auto-closed
 * - When Terminal opens (side-peek): closes Details, remembers for restoration
 * - When Terminal closes: restores Details if it was auto-closed
 * - When Diff opens in side-peek while Details is open: switches to center-peek mode
 * - When user switches Diff to side-peek while Details is open: closes Details
 * - When Diff side-peek closes: restores Details if we closed it
 *
 * Note: Terminal/Diff in "bottom"/"center-peek"/"full-page" mode do NOT conflict with Details
 */
export function useSidebarMutualExclusion(
  state: SidebarMutualExclusionState,
  setters: SidebarMutualExclusionSetters
): void {
  const {
    isDetailsSidebarOpen,
    isPlanSidebarOpen,
    currentPlanPath,
    isTerminalSidebarOpen,
    terminalDisplayMode,
    isDiffSidebarOpen = false,
    diffDisplayMode = "center-peek",
  } = state

  const {
    setIsDetailsSidebarOpen,
    setIsPlanSidebarOpen,
    setIsTerminalSidebarOpen,
    setIsDiffSidebarOpen,
    setDiffDisplayMode,
  } = setters

  // Track what was auto-closed and by whom for restoration
  const autoClosedStateRef = useRef<AutoClosedState>({
    detailsClosedBy: null,
    planClosedByDetails: false,
    terminalClosedByDetails: false,
    diffClosedByDetails: false,
  })

  // Flag to skip center-peek switch when restoring Diff after Details closes
  const isRestoringDiffRef = useRef(false)

  // Track previous states to detect opens/closes
  // Note: For plan sidebar, we track isPlanSidebarOpen separately from currentPlanPath
  // to avoid race conditions when opening the sidebar before the plan path is set
  const prevSidebarStatesRef = useRef<PrevSidebarStates>({
    details: isDetailsSidebarOpen,
    planSidebarOpen: isPlanSidebarOpen,
    planHasPath: !!currentPlanPath,
    terminal: isTerminalSidebarOpen,
    diff: isDiffSidebarOpen,
    diffMode: diffDisplayMode,
  })

  useEffect(() => {
    const prev = prevSidebarStatesRef.current
    const auto = autoClosedStateRef.current
    const isPlanOpen = isPlanSidebarOpen && !!currentPlanPath

    // Detect state changes
    const detailsJustOpened = isDetailsSidebarOpen && !prev.details
    const detailsJustClosed = !isDetailsSidebarOpen && prev.details
    // Plan "opened" = sidebar was just opened OR sidebar is open and path just became valid
    const planJustOpened =
      (isPlanSidebarOpen && !prev.planSidebarOpen) ||
      (isPlanSidebarOpen && !!currentPlanPath && !prev.planHasPath)
    // Plan "closed" = sidebar was just closed (ignore path changes while sidebar is open)
    const planJustClosed = !isPlanSidebarOpen && prev.planSidebarOpen
    const terminalJustOpened = isTerminalSidebarOpen && !prev.terminal
    const terminalJustClosed = !isTerminalSidebarOpen && prev.terminal

    // Diff state changes (only if Diff setters are provided)
    const isNowDiffSidePeek = isDiffSidebarOpen && diffDisplayMode === "side-peek"
    const wasDiffSidePeek = prev.diff && prev.diffMode === "side-peek"
    const diffSidePeekJustClosed = wasDiffSidePeek && !isNowDiffSidePeek

    // Terminal in "bottom" mode doesn't conflict with Details sidebar
    const terminalConflictsWithDetails = terminalDisplayMode === "side-peek"

    // Details opened → close conflicting sidebars and remember
    if (detailsJustOpened) {
      if (isPlanOpen) {
        auto.planClosedByDetails = true
        setIsPlanSidebarOpen(false)
      }
      if (isTerminalSidebarOpen && terminalConflictsWithDetails) {
        auto.terminalClosedByDetails = true
        setIsTerminalSidebarOpen(false)
      }
      // Close Diff side-peek if open
      if (isNowDiffSidePeek && setIsDiffSidebarOpen) {
        auto.diffClosedByDetails = true
        setIsDiffSidebarOpen(false)
      }
    }
    // Details closed → restore what it closed
    else if (detailsJustClosed) {
      if (auto.planClosedByDetails) {
        auto.planClosedByDetails = false
        setIsPlanSidebarOpen(true)
      }
      if (auto.terminalClosedByDetails) {
        auto.terminalClosedByDetails = false
        setIsTerminalSidebarOpen(true)
      }
      // Restore Diff if we closed it
      if (auto.diffClosedByDetails && setIsDiffSidebarOpen) {
        auto.diffClosedByDetails = false
        isRestoringDiffRef.current = true
        setIsDiffSidebarOpen(true)
        // Reset flag after state update
        requestAnimationFrame(() => {
          isRestoringDiffRef.current = false
        })
      }
    }
    // Plan opened → close Details and remember
    else if (planJustOpened && isDetailsSidebarOpen) {
      auto.detailsClosedBy = "plan"
      // Clear diffClosedByDetails to prevent the Diff effect from restoring Diff
      // when it detects Details closing (which would cause a conflict)
      auto.diffClosedByDetails = false
      setIsDetailsSidebarOpen(false)
    }
    // Plan closed → restore Details if we closed it
    else if (planJustClosed && auto.detailsClosedBy === "plan") {
      auto.detailsClosedBy = null
      setIsDetailsSidebarOpen(true)
    }
    // Terminal opened → close Details and remember (only in side-peek mode)
    else if (
      terminalJustOpened &&
      isDetailsSidebarOpen &&
      terminalConflictsWithDetails
    ) {
      auto.detailsClosedBy = "terminal"
      // Clear diffClosedByDetails to prevent the Diff effect from restoring Diff
      // when it detects Details closing (which would cause a conflict)
      auto.diffClosedByDetails = false
      setIsDetailsSidebarOpen(false)
    }
    // Terminal closed → restore Details if we closed it
    else if (terminalJustClosed && auto.detailsClosedBy === "terminal") {
      auto.detailsClosedBy = null
      setIsDetailsSidebarOpen(true)
    }
    // Diff sidebar handling (only if setters are provided)
    else if (setIsDiffSidebarOpen && setDiffDisplayMode) {
      // Diff is now in side-peek mode and Details is open
      if (isNowDiffSidePeek && isDetailsSidebarOpen) {
        // Details just opened while Diff is in side-peek → this case is handled above
        // Diff just opened in side-peek mode → switch to dialog (don't close Details)
        // Skip if we're restoring Diff after Details closed
        if (!prev.diff && !isRestoringDiffRef.current) {
          setDiffDisplayMode("center-peek")
        }
        // User manually switched to side-peek while Diff was already open → close Details and remember
        else if (prev.diff && prev.diffMode !== "side-peek") {
          auto.detailsClosedBy = "diff"
          setIsDetailsSidebarOpen(false)
        }
      }
      // Diff side-peek closed → restore Details if we closed it
      else if (diffSidePeekJustClosed && auto.detailsClosedBy === "diff") {
        auto.detailsClosedBy = null
        setIsDetailsSidebarOpen(true)
      }
    }

    prevSidebarStatesRef.current = {
      details: isDetailsSidebarOpen,
      planSidebarOpen: isPlanSidebarOpen,
      planHasPath: !!currentPlanPath,
      terminal: isTerminalSidebarOpen,
      diff: isDiffSidebarOpen,
      diffMode: diffDisplayMode,
    }
  }, [
    isDetailsSidebarOpen,
    isPlanSidebarOpen,
    currentPlanPath,
    isTerminalSidebarOpen,
    terminalDisplayMode,
    isDiffSidebarOpen,
    diffDisplayMode,
    setIsDetailsSidebarOpen,
    setIsPlanSidebarOpen,
    setIsTerminalSidebarOpen,
    setIsDiffSidebarOpen,
    setDiffDisplayMode,
  ])
}
