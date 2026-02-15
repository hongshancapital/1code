/**
 * DetailsPanelWrapper — 自治的 Details 面板组件
 *
 * DetailsSidebar 内部自带 ResizableSidebar 容器。
 * 属于 DETAILS group（非互斥）。
 *
 * 注意：DetailsSidebar 的 props 较多，暂时通过 atom/context 获取大部分数据，
 * 部分跨 panel 交互（如 onExpandDiff, onExpandTerminal）通过 usePanel() 实现。
 */

import { memo, useCallback, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useChatInstance } from "../../../context/chat-instance-context"
import { usePlatform } from "../../../../../contexts/PlatformContext"
import { usePanel } from "../../../hooks/use-panel-state"
import { useDiffData } from "../../../hooks/use-diff-data"
import { useAgentSubChatStore } from "../../../stores/sub-chat-store"
import { PANEL_IDS } from "../../../stores/panel-registry"
import {
  currentPlanPathAtomFamily,
  planEditRefetchTriggerAtomFamily,
  pendingBuildPlanSubChatIdAtom,
  diffSidebarOpenAtomFamily,
  diffViewDisplayModeAtom,
  diffHasPendingChangesAtomFamily,
  subChatModeAtomFamily,
  fileViewerOpenAtomFamily,
  selectedDiffFilePathAtom,
  filteredDiffFilesAtom,
  explorerPanelOpenAtomFamily,
} from "../../../atoms"
import { defaultAgentModeAtom } from "../../../../../lib/atoms"
import { unifiedSidebarEnabledAtom } from "../../../../details-sidebar/atoms"
import { DetailsSidebar } from "../../../../details-sidebar/details-sidebar"
import type { PanelRenderProps } from "../types"
import type { AgentMode } from "../../../atoms"

// =============================================================================
// Availability Hook
// =============================================================================

export function useDetailsAvailability(): boolean {
  const { worktreePath, sandboxId } = useChatInstance()
  const isUnifiedSidebarEnabled = useAtomValue(unifiedSidebarEnabledAtom)
  return isUnifiedSidebarEnabled && (!!worktreePath || !!sandboxId)
}

// =============================================================================
// DetailsPanelWrapper Component
// =============================================================================

export const DetailsPanelWrapper = memo(function DetailsPanelWrapper({
  onClose,
}: PanelRenderProps) {
  const { chatId, worktreePath, sandboxId, agentChat } = useChatInstance()
  const { isDesktop } = usePlatform()

  // ── SubChat state ──
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)

  // ── Plan state ──
  const currentPlanPath = useAtomValue(
    currentPlanPathAtomFamily(activeSubChatId || ""),
  )
  const planEditRefetchTrigger = useAtomValue(
    planEditRefetchTriggerAtomFamily(activeSubChatId || ""),
  )

  // ── Agent mode ──
  const subChatModeAtom = useMemo(
    () => subChatModeAtomFamily(activeSubChatId || ""),
    [activeSubChatId],
  )
  const [subChatMode] = useAtom(subChatModeAtom)
  const defaultMode = useAtomValue(defaultAgentModeAtom)
  const currentMode: AgentMode = activeSubChatId ? subChatMode : defaultMode

  // ── Plan approval ──
  const setPendingBuildPlanSubChatId = useSetAtom(pendingBuildPlanSubChatIdAtom)
  const handleBuildPlan = useCallback(() => {
    const freshId = useAgentSubChatStore.getState().activeSubChatId
    if (freshId) setPendingBuildPlanSubChatId(freshId)
  }, [setPendingBuildPlanSubChatId])

  // ── Panel handles ──
  const planPanel = usePanel(PANEL_IDS.PLAN)
  const terminalPanel = usePanel(PANEL_IDS.TERMINAL)
  const diffPanel = usePanel(PANEL_IDS.DIFF)
  const explorerPanel = usePanel(PANEL_IDS.EXPLORER)

  // ── Diff state ──
  const [isDiffSidebarOpen, setIsDiffSidebarOpen] = useAtom(
    useMemo(() => diffSidebarOpenAtomFamily(chatId), [chatId]),
  )
  const [diffDisplayMode] = useAtom(diffViewDisplayModeAtom)
  const [hasPendingDiffChanges, setHasPendingDiffChanges] = useAtom(
    useMemo(() => diffHasPendingChangesAtomFamily(chatId), [chatId]),
  )

  // ── Diff data (for stats) ──
  const { diffStats, parsedFileDiffs } = useDiffData({
    chatId,
    worktreePath,
    sandboxId: sandboxId ?? undefined,
    isDesktopPlatform: isDesktop,
    isDiffSidebarOpen,
    setHasPendingDiffChanges,
    agentChat: agentChat as any,
  })

  // ── Expand handlers ──
  const handleExpandTerminal = useCallback(() => {
    terminalPanel.open()
  }, [terminalPanel])

  const handleExpandPlan = useCallback(() => {
    planPanel.open()
  }, [planPanel])

  const handleExpandDiff = useCallback(() => {
    diffPanel.open()
  }, [diffPanel])

  const handleExpandExplorer = useCallback(() => {
    explorerPanel.open()
  }, [explorerPanel])

  // ── File selection (for diff filtering) ──
  const setSelectedFilePath = useSetAtom(selectedDiffFilePathAtom)
  const setFilteredDiffFiles = useSetAtom(filteredDiffFilesAtom)
  const handleFileSelect = useCallback(
    (filePath: string) => {
      setSelectedFilePath(filePath)
      setFilteredDiffFiles([filePath])
      setIsDiffSidebarOpen(true)
    },
    [setSelectedFilePath, setFilteredDiffFiles, setIsDiffSidebarOpen],
  )

  // ── Explorer state ──
  const [isExplorerOpen] = useAtom(
    useMemo(() => explorerPanelOpenAtomFamily(chatId), [chatId]),
  )

  // ── Remote info ──
  const remoteInfo = null // TODO: wire up when remote chat support is needed

  return (
    <DetailsSidebar
      chatId={chatId}
      worktreePath={worktreePath}
      planPath={currentPlanPath}
      mode={currentMode}
      onBuildPlan={handleBuildPlan}
      planRefetchTrigger={planEditRefetchTrigger}
      activeSubChatId={activeSubChatId}
      isPlanSidebarOpen={planPanel.isOpen && !!currentPlanPath}
      isTerminalSidebarOpen={terminalPanel.isOpen}
      isDiffSidebarOpen={isDiffSidebarOpen}
      diffDisplayMode={diffDisplayMode}
      canOpenDiff={!!worktreePath || (!!sandboxId && !isDesktop)}
      setIsDiffSidebarOpen={setIsDiffSidebarOpen}
      diffStats={diffStats}
      parsedFileDiffs={parsedFileDiffs}
      onCommit={() => {}}
      isCommitting={false}
      onExpandTerminal={handleExpandTerminal}
      onExpandPlan={handleExpandPlan}
      onExpandDiff={handleExpandDiff}
      onExpandExplorer={handleExpandExplorer}
      isExplorerSidebarOpen={isExplorerOpen}
      onFileSelect={handleFileSelect}
      remoteInfo={remoteInfo}
      isRemoteChat={false}
    />
  )
})
