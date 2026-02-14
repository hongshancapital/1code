/**
 * useSidebarManager - Unified sidebar state management
 *
 * This hook consolidates sidebar state management that was previously
 * scattered across ChatView in active-chat.tsx.
 *
 * Sidebars managed:
 * - Diff sidebar (with display modes: side-peek, center-peek, full-page)
 * - Plan sidebar
 * - Terminal sidebar (with display modes: side-peek, bottom)
 * - Browser sidebar (mutual exclusion with Details)
 * - File viewer sidebar (with display modes)
 * - Explorer panel
 * - Details sidebar (unified sidebar combining all right sidebars)
 *
 * Mutual Exclusion Rules:
 * - Details sidebar vs Plan/Terminal/Diff(side-peek) - one closes the other
 * - Browser sidebar vs Details sidebar - browser takes priority
 * - When one opens, the other auto-closes with restoration tracking
 *
 * Usage:
 *   const sidebars = useSidebarManager({ chatId, activeSubChatId })
 *   sidebars.diff.isOpen
 *   sidebars.diff.open()
 *   sidebars.diff.close()
 *   sidebars.diff.toggle()
 */

import { useCallback, useEffect, useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  diffSidebarOpenAtomFamily,
  diffViewModeAtom,
  diffViewDisplayModeAtom,
  planSidebarOpenAtomFamily,
  currentPlanPathAtomFamily,
  planEditRefetchTriggerAtomFamily,
  fileViewerOpenAtomFamily,
  fileViewerDisplayModeAtom,
  explorerPanelOpenAtomFamily,
  agentsDiffSidebarWidthAtom,
  pendingBuildPlanSubChatIdAtom,
} from "../atoms/index"
import {
  terminalSidebarOpenAtomFamily,
  terminalDisplayModeAtom,
} from "../../terminal/atoms"
import {
  browserVisibleAtomFamily,
  browserActiveAtomFamily,
  browserUrlAtomFamily,
  browserPendingScreenshotAtomFamily,
} from "../../browser-sidebar/atoms"
import {
  detailsSidebarOpenAtom,
  unifiedSidebarEnabledAtom,
} from "../../details-sidebar/atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { appStore } from "../../../lib/jotai-store"
import type { DiffViewMode, DiffViewDisplayMode } from "../ui/agent-diff-view"

export interface SidebarManagerOptions {
  chatId: string
  /** Active sub-chat ID, used for plan sidebar */
  activeSubChatId?: string | null
}

export interface SidebarState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export interface DiffSidebarState extends SidebarState {
  displayMode: DiffViewDisplayMode
  setDisplayMode: (mode: DiffViewDisplayMode) => void
  viewMode: DiffViewMode
  setViewMode: (mode: DiffViewMode) => void
}

export interface PlanSidebarState extends SidebarState {
  currentPath: string | null
  setCurrentPath: (path: string | null) => void
  triggerRefetch: () => void
  handleApprovePlan: () => void
}

export interface TerminalSidebarState extends SidebarState {
  displayMode: "side-peek" | "bottom"
}

export interface BrowserSidebarState extends SidebarState {
  isActive: boolean
  setActive: (active: boolean) => void
  url: string
  setUrl: (url: string) => void
  setPendingScreenshot: (screenshot: string | null) => void
}

export interface FileViewerState extends SidebarState {
  path: string | null
  setPath: (path: string | null) => void
  displayMode: "side-peek" | "center-peek" | "full-page"
}

export interface SidebarManagerResult {
  diff: DiffSidebarState
  plan: PlanSidebarState
  terminal: TerminalSidebarState
  browser: BrowserSidebarState
  fileViewer: FileViewerState
  explorer: SidebarState
  details: SidebarState
  /** Unified sidebar enabled (combines all right sidebars) */
  isUnifiedSidebarEnabled: boolean
}

/**
 * Track auto-closed state for restoration logic
 */
interface AutoClosedState {
  /** What closed Details sidebar */
  detailsClosedBy: "plan" | "terminal" | "diff" | null
  /** What Details sidebar closed */
  planClosedByDetails: boolean
  terminalClosedByDetails: boolean
  diffClosedByDetails: boolean
}

export function useSidebarManager({
  chatId,
  activeSubChatId,
}: SidebarManagerOptions): SidebarManagerResult {
  // ==========================================================================
  // Atoms
  // ==========================================================================

  // Diff sidebar
  const diffSidebarAtom = useMemo(
    () => diffSidebarOpenAtomFamily(chatId),
    [chatId],
  )
  const [isDiffOpen, setIsDiffOpen] = useAtom(diffSidebarAtom)
  const [diffViewMode, setDiffViewMode] = useAtom(diffViewModeAtom)
  const [diffDisplayMode, setDiffDisplayMode] = useAtom(diffViewDisplayModeAtom)

  // Plan sidebar
  const planSidebarAtom = useMemo(
    () => planSidebarOpenAtomFamily(activeSubChatId || ""),
    [activeSubChatId],
  )
  const [isPlanOpen, setIsPlanOpen] = useAtom(planSidebarAtom)
  const planPathAtom = useMemo(
    () => currentPlanPathAtomFamily(activeSubChatId || ""),
    [activeSubChatId],
  )
  const [currentPlanPath, setCurrentPlanPath] = useAtom(planPathAtom)
  const planRefetchAtom = useMemo(
    () => planEditRefetchTriggerAtomFamily(activeSubChatId || ""),
    [activeSubChatId],
  )
  const triggerPlanRefetch = useSetAtom(planRefetchAtom)
  const setPendingBuildPlanSubChatId = useSetAtom(pendingBuildPlanSubChatIdAtom)

  // Terminal sidebar
  const terminalSidebarAtom = useMemo(
    () => terminalSidebarOpenAtomFamily(chatId),
    [chatId],
  )
  const [isTerminalOpen, setIsTerminalOpen] = useAtom(terminalSidebarAtom)
  const terminalDisplayMode = useAtomValue(terminalDisplayModeAtom)

  // Browser sidebar
  const browserVisibleAtom = useMemo(
    () => browserVisibleAtomFamily(chatId),
    [chatId],
  )
  const [isBrowserOpenRaw, setIsBrowserOpenRaw] = useAtom(browserVisibleAtom)
  const browserActiveAtom = useMemo(
    () => browserActiveAtomFamily(chatId),
    [chatId],
  )
  const [isBrowserActive, setBrowserActive] = useAtom(browserActiveAtom)
  const browserUrlAtom = useMemo(
    () => browserUrlAtomFamily(chatId),
    [chatId],
  )
  const [browserUrl, setBrowserUrl] = useAtom(browserUrlAtom)
  const browserScreenshotAtom = useMemo(
    () => browserPendingScreenshotAtomFamily(chatId),
    [chatId],
  )
  const setBrowserPendingScreenshot = useSetAtom(browserScreenshotAtom)

  // File viewer
  const fileViewerAtom = useMemo(
    () => fileViewerOpenAtomFamily(chatId),
    [chatId],
  )
  const [fileViewerPath, setFileViewerPath] = useAtom(fileViewerAtom)
  const fileViewerDisplayMode = useAtomValue(fileViewerDisplayModeAtom)

  // Explorer panel
  const explorerPanelAtom = useMemo(
    () => explorerPanelOpenAtomFamily(chatId),
    [chatId],
  )
  const [isExplorerOpen, setIsExplorerOpen] = useAtom(explorerPanelAtom)

  // Details sidebar (unified)
  const isUnifiedSidebarEnabled = useAtomValue(unifiedSidebarEnabledAtom)
  const [isDetailsOpenRaw, setIsDetailsOpenRaw] = useAtom(detailsSidebarOpenAtom)

  // ==========================================================================
  // Mutual Exclusion Logic
  // ==========================================================================

  // Track auto-closed state for restoration
  const autoClosedStateRef = useRef<AutoClosedState>({
    detailsClosedBy: null,
    planClosedByDetails: false,
    terminalClosedByDetails: false,
    diffClosedByDetails: false,
  })

  // Track previous states to detect opens/closes
  const prevSidebarStatesRef = useRef({
    details: isDetailsOpenRaw,
    planOpen: isPlanOpen,
    planHasPath: !!currentPlanPath,
    terminal: isTerminalOpen,
    diffOpen: isDiffOpen,
    diffMode: diffDisplayMode,
  })

  // Flag to skip center-peek switch when restoring Diff after Details closes
  const isRestoringDiffRef = useRef(false)

  // Browser/Details mutual exclusion wrapper
  const setIsBrowserOpen = useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      const newValue = typeof open === "function" ? open(isBrowserOpenRaw) : open
      if (newValue) {
        setIsDetailsOpenRaw(false) // Close details when opening browser
      }
      setIsBrowserOpenRaw(newValue)
    },
    [isBrowserOpenRaw, setIsBrowserOpenRaw, setIsDetailsOpenRaw],
  )

  const setIsDetailsOpen = useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      const newValue = typeof open === "function" ? open(isDetailsOpenRaw) : open
      // Note: We intentionally do NOT close browser sidebar when opening details
      // Both can be open at the same time
      setIsDetailsOpenRaw(newValue)
    },
    [isDetailsOpenRaw, setIsDetailsOpenRaw],
  )

  // Plan/Terminal/Details mutual exclusion
  useEffect(() => {
    const prev = prevSidebarStatesRef.current
    const auto = autoClosedStateRef.current
    const isPlanEffectivelyOpen = isPlanOpen && !!currentPlanPath

    // Detect state changes
    const detailsJustOpened = isDetailsOpenRaw && !prev.details
    const detailsJustClosed = !isDetailsOpenRaw && prev.details
    const planJustOpened =
      (isPlanOpen && !prev.planOpen) ||
      (isPlanOpen && !!currentPlanPath && !prev.planHasPath)
    const planJustClosed = !isPlanOpen && prev.planOpen
    const terminalJustOpened = isTerminalOpen && !prev.terminal
    const terminalJustClosed = !isTerminalOpen && prev.terminal

    // Terminal in "bottom" mode doesn't conflict with Details sidebar
    const terminalConflictsWithDetails = terminalDisplayMode === "side-peek"

    // Details opened → close conflicting sidebars and remember
    if (detailsJustOpened) {
      if (isPlanEffectivelyOpen) {
        auto.planClosedByDetails = true
        setIsPlanOpen(false)
      }
      if (isTerminalOpen && terminalConflictsWithDetails) {
        auto.terminalClosedByDetails = true
        setIsTerminalOpen(false)
      }
    }
    // Details closed → restore what it closed
    else if (detailsJustClosed) {
      if (auto.planClosedByDetails) {
        auto.planClosedByDetails = false
        setIsPlanOpen(true)
      }
      if (auto.terminalClosedByDetails) {
        auto.terminalClosedByDetails = false
        setIsTerminalOpen(true)
      }
    }
    // Plan opened → close Details and remember
    else if (planJustOpened && isDetailsOpenRaw) {
      auto.detailsClosedBy = "plan"
      auto.diffClosedByDetails = false
      setIsDetailsOpenRaw(false)
    }
    // Plan closed → restore Details if we closed it
    else if (planJustClosed && auto.detailsClosedBy === "plan") {
      auto.detailsClosedBy = null
      setIsDetailsOpenRaw(true)
    }
    // Terminal opened → close Details and remember (only in side-peek mode)
    else if (
      terminalJustOpened &&
      isDetailsOpenRaw &&
      terminalConflictsWithDetails
    ) {
      auto.detailsClosedBy = "terminal"
      auto.diffClosedByDetails = false
      setIsDetailsOpenRaw(false)
    }
    // Terminal closed → restore Details if we closed it
    else if (terminalJustClosed && auto.detailsClosedBy === "terminal") {
      auto.detailsClosedBy = null
      setIsDetailsOpenRaw(true)
    }

    prevSidebarStatesRef.current = {
      ...prevSidebarStatesRef.current,
      details: isDetailsOpenRaw,
      planOpen: isPlanOpen,
      planHasPath: !!currentPlanPath,
      terminal: isTerminalOpen,
    }
  }, [
    isDetailsOpenRaw,
    isPlanOpen,
    currentPlanPath,
    isTerminalOpen,
    terminalDisplayMode,
    setIsDetailsOpenRaw,
    setIsPlanOpen,
    setIsTerminalOpen,
  ])

  // Diff + Details sidebar conflict (side-peek mode only)
  useEffect(() => {
    const prev = prevSidebarStatesRef.current
    const auto = autoClosedStateRef.current
    const isNowSidePeek = isDiffOpen && diffDisplayMode === "side-peek"
    const wasSidePeek = prev.diffOpen && prev.diffMode === "side-peek"
    const detailsJustOpened = isDetailsOpenRaw && !prev.details
    const detailsJustClosed = !isDetailsOpenRaw && prev.details
    const diffSidePeekJustClosed = wasSidePeek && !isNowSidePeek

    if (isNowSidePeek && isDetailsOpenRaw) {
      // Details just opened while Diff is in side-peek → close Diff and remember
      if (detailsJustOpened) {
        auto.diffClosedByDetails = true
        setIsDiffOpen(false)
      }
      // Diff just opened in side-peek mode → switch to dialog (don't close Details)
      else if (!prev.diffOpen && !isRestoringDiffRef.current) {
        setDiffDisplayMode("center-peek")
      }
      // User manually switched to side-peek while Diff was already open → close Details and remember
      else if (prev.diffOpen && prev.diffMode !== "side-peek") {
        auto.detailsClosedBy = "diff"
        setIsDetailsOpenRaw(false)
      }
    }
    // Diff side-peek closed → restore Details if we closed it
    else if (diffSidePeekJustClosed && auto.detailsClosedBy === "diff") {
      auto.detailsClosedBy = null
      setIsDetailsOpenRaw(true)
    }
    // Details closed → restore Diff if we closed it (in side-peek mode)
    else if (detailsJustClosed && auto.diffClosedByDetails) {
      auto.diffClosedByDetails = false
      isRestoringDiffRef.current = true
      setIsDiffOpen(true)
      // Reset flag after state update
      requestAnimationFrame(() => {
        isRestoringDiffRef.current = false
      })
    }

    prevSidebarStatesRef.current = {
      ...prevSidebarStatesRef.current,
      diffOpen: isDiffOpen,
      diffMode: diffDisplayMode,
      details: isDetailsOpenRaw,
    }
  }, [
    isDiffOpen,
    diffDisplayMode,
    isDetailsOpenRaw,
    setDiffDisplayMode,
    setIsDetailsOpenRaw,
    setIsDiffOpen,
  ])

  // Force narrow width when switching to side-peek mode (from dialog/fullscreen)
  useEffect(() => {
    if (diffDisplayMode === "side-peek") {
      appStore.set(agentsDiffSidebarWidthAtom, 400)
    }
  }, [diffDisplayMode])

  // Close plan sidebar when switching to a sub-chat that has no plan
  const prevSubChatIdRef = useRef(activeSubChatId)
  useEffect(() => {
    if (prevSubChatIdRef.current !== activeSubChatId) {
      // Sub-chat changed - if new one has no plan path, close sidebar
      if (!currentPlanPath) {
        setIsPlanOpen(false)
      }
      prevSubChatIdRef.current = activeSubChatId
    }
  }, [activeSubChatId, currentPlanPath, setIsPlanOpen])

  // ==========================================================================
  // Callbacks
  // ==========================================================================

  // Diff callbacks
  const openDiff = useCallback(() => setIsDiffOpen(true), [setIsDiffOpen])
  const closeDiff = useCallback(() => setIsDiffOpen(false), [setIsDiffOpen])
  const toggleDiff = useCallback(
    () => setIsDiffOpen((prev) => !prev),
    [setIsDiffOpen],
  )

  // Plan callbacks
  const openPlan = useCallback(() => {
    setIsPlanOpen(true)
    // Always trigger refetch when expanding to ensure fresh content
    triggerPlanRefetch()
  }, [setIsPlanOpen, triggerPlanRefetch])
  const closePlan = useCallback(() => setIsPlanOpen(false), [setIsPlanOpen])
  const togglePlan = useCallback(
    () => setIsPlanOpen((prev) => !prev),
    [setIsPlanOpen],
  )
  const handleApprovePlan = useCallback(() => {
    const activeId = useAgentSubChatStore.getState().activeSubChatId
    if (activeId) {
      setPendingBuildPlanSubChatId(activeId)
    }
  }, [setPendingBuildPlanSubChatId])

  // Terminal callbacks
  const openTerminal = useCallback(
    () => setIsTerminalOpen(true),
    [setIsTerminalOpen],
  )
  const closeTerminal = useCallback(
    () => setIsTerminalOpen(false),
    [setIsTerminalOpen],
  )
  const toggleTerminal = useCallback(
    () => setIsTerminalOpen((prev) => !prev),
    [setIsTerminalOpen],
  )

  // Browser callbacks
  const openBrowser = useCallback(
    () => setIsBrowserOpen(true),
    [setIsBrowserOpen],
  )
  const closeBrowser = useCallback(
    () => setIsBrowserOpen(false),
    [setIsBrowserOpen],
  )
  const toggleBrowser = useCallback(
    () => setIsBrowserOpen((prev) => !prev),
    [setIsBrowserOpen],
  )

  // File viewer callbacks
  const openFileViewer = useCallback(
    (path: string) => setFileViewerPath(path),
    [setFileViewerPath],
  )
  const closeFileViewer = useCallback(
    () => setFileViewerPath(null),
    [setFileViewerPath],
  )
  const toggleFileViewer = useCallback(() => {
    // Toggle doesn't make sense without a path, so this is a no-op
    // Use openFileViewer(path) instead
  }, [])

  // Explorer callbacks
  const openExplorer = useCallback(
    () => setIsExplorerOpen(true),
    [setIsExplorerOpen],
  )
  const closeExplorer = useCallback(
    () => setIsExplorerOpen(false),
    [setIsExplorerOpen],
  )
  const toggleExplorer = useCallback(
    () => setIsExplorerOpen((prev) => !prev),
    [setIsExplorerOpen],
  )

  // Details callbacks
  const openDetails = useCallback(
    () => setIsDetailsOpen(true),
    [setIsDetailsOpen],
  )
  const closeDetails = useCallback(
    () => setIsDetailsOpen(false),
    [setIsDetailsOpen],
  )
  const toggleDetails = useCallback(
    () => setIsDetailsOpen((prev) => !prev),
    [setIsDetailsOpen],
  )

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    diff: {
      isOpen: isDiffOpen,
      open: openDiff,
      close: closeDiff,
      toggle: toggleDiff,
      displayMode: diffDisplayMode,
      setDisplayMode: setDiffDisplayMode,
      viewMode: diffViewMode,
      setViewMode: setDiffViewMode,
    },
    plan: {
      isOpen: isPlanOpen,
      open: openPlan,
      close: closePlan,
      toggle: togglePlan,
      currentPath: currentPlanPath,
      setCurrentPath: setCurrentPlanPath,
      triggerRefetch: triggerPlanRefetch,
      handleApprovePlan,
    },
    terminal: {
      isOpen: isTerminalOpen,
      open: openTerminal,
      close: closeTerminal,
      toggle: toggleTerminal,
      displayMode: terminalDisplayMode,
    },
    browser: {
      isOpen: isBrowserOpenRaw,
      open: openBrowser,
      close: closeBrowser,
      toggle: toggleBrowser,
      isActive: isBrowserActive,
      setActive: setBrowserActive,
      url: browserUrl,
      setUrl: setBrowserUrl,
      setPendingScreenshot: setBrowserPendingScreenshot,
    },
    fileViewer: {
      isOpen: !!fileViewerPath,
      open: openFileViewer as unknown as () => void, // Type hack for consistency
      close: closeFileViewer,
      toggle: toggleFileViewer,
      path: fileViewerPath,
      setPath: setFileViewerPath,
      displayMode: fileViewerDisplayMode,
    },
    explorer: {
      isOpen: isExplorerOpen,
      open: openExplorer,
      close: closeExplorer,
      toggle: toggleExplorer,
    },
    details: {
      isOpen: isDetailsOpenRaw,
      open: openDetails,
      close: closeDetails,
      toggle: toggleDetails,
    },
    isUnifiedSidebarEnabled,
  }
}
