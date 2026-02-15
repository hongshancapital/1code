/**
 * DiffPanel — 自治的 Diff 面板组件
 *
 * 从 Context/Atom/Store/Hook 获取所有业务数据。
 * 内部调用 useDiffData、usePrGitOperations、useDiffSidebarLayout，
 * 然后传给现有的 DiffStateProvider + DiffSidebarRenderer。
 *
 * 注意：DiffSidebarRenderer 内部自带容器路由（side-peek/center-peek/full-page），
 * 所以 DiffPanel 在 PanelZone 中渲染时不需要外部容器包装。
 * 通过 PanelRenderProps 接收 displayMode 信息但由内部容器处理。
 */

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { useShallow } from "zustand/react/shallow"
import { useChatInstance } from "../../../context/chat-instance-context"
import { usePlatform } from "../../../../../contexts/PlatformContext"
import { usePanel } from "../../../hooks/use-panel-state"
import { useDiffData } from "../../../hooks/use-diff-data"
import { usePrGitOperations } from "../../../hooks/use-pr-git-operations"
import { useDiffSidebarLayout } from "../../../hooks/use-diff-sidebar-layout"
import { useAgentSubChatStore } from "../../../stores/sub-chat-store"
import { PANEL_IDS } from "../../../stores/panel-registry"
import {
  diffSidebarOpenAtomFamily,
  diffViewDisplayModeAtom,
  diffHasPendingChangesAtomFamily,
  subChatFilesAtom,
  fileViewerOpenAtomFamily,
  fileViewerDisplayModeAtom,
} from "../../../atoms"
import {
  isDesktopAtom,
  isFullscreenAtom,
} from "../../../../../lib/atoms"
import { diffViewModeAtom } from "../../agent-diff-view"
import { DiffStateProvider, DiffSidebarRenderer } from "../../diff-sidebar/diff-sidebar-components"
import type { AgentDiffViewRef } from "../../agent-diff-view"
import type { PanelRenderProps } from "../types"

// =============================================================================
// Availability Hook
// =============================================================================

export function useDiffAvailability(): boolean {
  const { worktreePath, sandboxId } = useChatInstance()
  const { isDesktop } = usePlatform()
  // Can open diff if local worktree exists, or sandbox on web platform
  return !!worktreePath || (!!sandboxId && !isDesktop)
}

// =============================================================================
// DiffPanel Component
// =============================================================================

export const DiffPanel = memo(function DiffPanel(_props: PanelRenderProps) {
  // ── 从 Context 获取身份信息 ──
  const { chatId, worktreePath, sandboxId, agentChat } = useChatInstance()
  const { isDesktop } = usePlatform()
  const isDesktopAtomValue = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)

  // ── Diff open/close state ──
  const diffSidebarAtom = useMemo(
    () => diffSidebarOpenAtomFamily(chatId),
    [chatId],
  )
  const [isDiffSidebarOpen, setIsDiffSidebarOpen] = useAtom(diffSidebarAtom)

  // ── Diff display mode ──
  const [diffMode, setDiffMode] = useAtom(diffViewModeAtom)
  const [diffDisplayMode, setDiffDisplayMode] = useAtom(diffViewDisplayModeAtom)

  // ── Pending changes ──
  const pendingDiffChangesAtom = useMemo(
    () => diffHasPendingChangesAtomFamily(chatId),
    [chatId],
  )
  const [hasPendingDiffChanges, setHasPendingDiffChanges] = useAtom(pendingDiffChangesAtom)

  // ── FileViewer state (needed for layout calculation) ──
  const fileViewerAtom = useMemo(
    () => fileViewerOpenAtomFamily(chatId),
    [chatId],
  )
  const [fileViewerPath] = useAtom(fileViewerAtom)
  const [fileViewerDisplayMode] = useAtom(fileViewerDisplayModeAtom)

  // ── Diff data ──
  const {
    diffStats,
    parsedFileDiffs,
    prefetchedFileContents,
    diffContent,
    setDiffStats,
    setParsedFileDiffs,
    setPrefetchedFileContents,
    setDiffContent,
    fetchDiffStats,
  } = useDiffData({
    chatId,
    worktreePath,
    sandboxId: sandboxId ?? undefined,
    isDesktopPlatform: isDesktop,
    isDiffSidebarOpen,
    setHasPendingDiffChanges,
    agentChat: agentChat as any,
  })

  // ── Diff layout ──
  const {
    diffSidebarRef,
    diffSidebarWidth,
    isDiffSidebarNarrow,
  } = useDiffSidebarLayout({
    isDiffSidebarOpen,
    diffDisplayMode,
    fileViewerPath,
    fileViewerDisplayMode,
  })

  const diffViewRef = useRef<AgentDiffViewRef>(null)
  const [_diffCollapseState, setDiffCollapseState] = useState({
    allCollapsed: false,
    allExpanded: true,
  })

  // ── SubChat state ──
  const { activeSubChatId, allSubChats } = useAgentSubChatStore(
    useShallow((s) => ({
      activeSubChatId: s.activeSubChatId,
      allSubChats: s.allSubChats,
    })),
  )
  const activeSubChatIdForPlan = useAgentSubChatStore((s) => s.activeSubChatId)

  // ── Panel handles for close adapters ──
  const planPanel = usePanel(PANEL_IDS.PLAN)

  // ── PR/Git operations ──
  const {
    hasPrNumber,
    isPrOpen,
    hasMergeConflicts,
    branchData,
    gitStatus,
    isGitStatusLoading,
    isCreatingPr,
    isReviewing,
    isCommittingToPr,
    mergePrMutation,
    handleCreatePrDirect,
    handleCreatePr,
    handleMergePr,
    handleCommitToPr,
    handleReview,
    handleSubmitReview,
    handleFixConflicts,
    handleRefreshGitStatus,
    handleRefreshDiff,
    handleExpandAll,
    handleCollapseAll,
    handleMarkAllViewed,
    handleMarkAllUnviewed,
  } = usePrGitOperations({
    chatId,
    worktreePath,
    isDiffSidebarOpen,
    activeSubChatId,
    activeSubChatIdForPlan,
    agentChat: agentChat as any,
    setHasPendingDiffChanges,
    parsedFileDiffs,
    setParsedFileDiffs,
    setPrefetchedFileContents,
    setDiffContent,
    setDiffStats,
    fetchDiffStats,
    diffViewRef,
    setIsPlanSidebarOpen: (v: boolean) => {
      if (v) planPanel.open()
      else planPanel.close()
    },
    setIsDiffSidebarOpen,
  })

  // ── subChatsWithFiles（diff filter）──
  const subChatFiles = useAtomValue(subChatFilesAtom)
  const subChatsWithFiles = useMemo(() => {
    const result: Array<{
      id: string
      name: string
      filePaths: string[]
      fileCount: number
      updatedAt: string
    }> = []

    for (const subChat of allSubChats) {
      const files = subChatFiles.get(subChat.id) || []
      if (files.length > 0) {
        result.push({
          id: subChat.id,
          name: subChat.name || "New Chat",
          filePaths: files.map((f) => f.filePath),
          fileCount: files.length,
          updatedAt: subChat.updated_at || subChat.created_at || "",
        })
      }
    }

    result.sort((a, b) => {
      if (!a.updatedAt && !b.updatedAt) return 0
      if (!a.updatedAt) return 1
      if (!b.updatedAt) return -1
      return (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    })

    return result
  }, [allSubChats, subChatFiles])

  // ── Repository ──
  const meta = agentChat?.meta as {
    repository?: { owner: string; name: string } | string
  } | null
  const repository =
    meta?.repository && typeof meta.repository === "object"
      ? meta.repository
      : null

  // ── Close handler adapter ──
  const handleCloseDiff = useCallback(() => {
    setIsDiffSidebarOpen(false)
  }, [setIsDiffSidebarOpen])

  // ── Render ──
  return (
    <DiffStateProvider
      isDiffSidebarOpen={isDiffSidebarOpen}
      parsedFileDiffs={parsedFileDiffs}
      isDiffSidebarNarrow={isDiffSidebarNarrow}
      setIsDiffSidebarOpen={setIsDiffSidebarOpen}
      setDiffStats={setDiffStats}
      setDiffContent={setDiffContent}
      setParsedFileDiffs={setParsedFileDiffs}
      setPrefetchedFileContents={setPrefetchedFileContents}
      fetchDiffStats={fetchDiffStats}
    >
      <DiffSidebarRenderer
        worktreePath={worktreePath}
        chatId={chatId}
        sandboxId={sandboxId}
        repository={repository}
        diffStats={diffStats}
        diffContent={diffContent}
        parsedFileDiffs={parsedFileDiffs}
        prefetchedFileContents={prefetchedFileContents}
        setDiffCollapseState={setDiffCollapseState}
        diffViewRef={diffViewRef}
        diffSidebarRef={diffSidebarRef}
        agentChat={agentChat}
        branchData={branchData}
        gitStatus={gitStatus}
        isGitStatusLoading={isGitStatusLoading}
        isDiffSidebarOpen={isDiffSidebarOpen}
        diffDisplayMode={diffDisplayMode}
        diffSidebarWidth={diffSidebarWidth}
        handleReview={handleReview}
        isReviewing={isReviewing}
        handleCreatePrDirect={handleCreatePrDirect}
        handleCreatePr={handleCreatePr}
        isCreatingPr={isCreatingPr}
        handleMergePr={handleMergePr}
        mergePrMutation={mergePrMutation}
        handleRefreshGitStatus={handleRefreshGitStatus}
        hasPrNumber={hasPrNumber}
        isPrOpen={isPrOpen}
        hasMergeConflicts={hasMergeConflicts}
        handleFixConflicts={handleFixConflicts}
        handleExpandAll={handleExpandAll}
        handleCollapseAll={handleCollapseAll}
        diffMode={diffMode}
        setDiffMode={setDiffMode}
        handleMarkAllViewed={handleMarkAllViewed}
        handleMarkAllUnviewed={handleMarkAllUnviewed}
        isDesktop={isDesktopAtomValue}
        isFullscreen={isFullscreen}
        setDiffDisplayMode={setDiffDisplayMode}
        handleCommitToPr={handleCommitToPr}
        isCommittingToPr={isCommittingToPr}
        subChatsWithFiles={subChatsWithFiles}
        setDiffStats={setDiffStats}
        activeSubChatId={activeSubChatId}
        onSubmitReview={handleSubmitReview}
        hasPendingDiffChanges={hasPendingDiffChanges}
        onRefreshDiff={handleRefreshDiff}
      />
    </DiffStateProvider>
  )
})
