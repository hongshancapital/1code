/**
 * useSidebarMutualExclusion - Manages mutual exclusion between sidebars
 *
 * Extracted from active-chat.tsx to improve maintainability.
 * Handles the logic where certain sidebars conflict with each other:
 * - Details sidebar conflicts with Plan and Terminal (side-peek mode)
 * - When one opens, it closes conflicting sidebars and remembers for restoration
 */

import { useEffect, useRef } from "react"

export interface SidebarMutualExclusionState {
  isDetailsSidebarOpen: boolean
  isPlanSidebarOpen: boolean
  currentPlanPath: string | null
  isTerminalSidebarOpen: boolean
  terminalDisplayMode: "side-peek" | "bottom"
}

export interface SidebarMutualExclusionSetters {
  setIsDetailsSidebarOpen: (value: boolean) => void
  setIsPlanSidebarOpen: (value: boolean) => void
  setIsTerminalSidebarOpen: (value: boolean) => void
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
}

/**
 * Hook to manage mutual exclusion between sidebars
 *
 * Behavior:
 * - When Details opens: closes Plan and Terminal (side-peek), remembers for restoration
 * - When Details closes: restores Plan/Terminal if they were auto-closed
 * - When Plan opens: closes Details, remembers for restoration
 * - When Plan closes: restores Details if it was auto-closed
 * - When Terminal opens (side-peek): closes Details, remembers for restoration
 * - When Terminal closes: restores Details if it was auto-closed
 *
 * Note: Terminal in "bottom" mode does NOT conflict with Details
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
  } = state

  const {
    setIsDetailsSidebarOpen,
    setIsPlanSidebarOpen,
    setIsTerminalSidebarOpen,
  } = setters

  // Track what was auto-closed and by whom for restoration
  const autoClosedStateRef = useRef<AutoClosedState>({
    detailsClosedBy: null,
    planClosedByDetails: false,
    terminalClosedByDetails: false,
    diffClosedByDetails: false,
  })

  // Track previous states to detect opens/closes
  // Note: For plan sidebar, we track isPlanSidebarOpen separately from currentPlanPath
  // to avoid race conditions when opening the sidebar before the plan path is set
  const prevSidebarStatesRef = useRef<PrevSidebarStates>({
    details: isDetailsSidebarOpen,
    planSidebarOpen: isPlanSidebarOpen,
    planHasPath: !!currentPlanPath,
    terminal: isTerminalSidebarOpen,
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

    prevSidebarStatesRef.current = {
      details: isDetailsSidebarOpen,
      planSidebarOpen: isPlanSidebarOpen,
      planHasPath: !!currentPlanPath,
      terminal: isTerminalSidebarOpen,
    }
  }, [
    isDetailsSidebarOpen,
    isPlanSidebarOpen,
    currentPlanPath,
    isTerminalSidebarOpen,
    terminalDisplayMode,
    setIsDetailsSidebarOpen,
    setIsPlanSidebarOpen,
    setIsTerminalSidebarOpen,
  ])
}
