import { useMemo, useCallback } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ListTodo, Package } from "lucide-react"
import { selectedProjectAtom, selectedAgentChatIdAtom, currentTodosAtomFamily } from "../agents/atoms"
import { useAgentSubChatStore } from "../../lib/stores/sub-chat-store"
import { api } from "../../lib/mock-api"

import { CollapsibleSection } from "./collapsible-section"
import { TaskPanelContent } from "./task-panel"
import { ArtifactsPanelContent, useArtifactsCount } from "./artifacts-panel"
import { FileTreePanel } from "./file-tree-panel"
import { taskSectionExpandedAtom, artifactsSectionExpandedAtom, filePreviewPathAtom } from "./atoms"

// ============================================================================
// Main Component - Three collapsible vertical sections
// ============================================================================

export function CoworkRightPanel() {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)

  // Fetch current chat data to get worktree path
  const { data: chatData } = api.agents.getAgentChat.useQuery(
    { chatId: selectedChatId! },
    { enabled: !!selectedChatId }
  )

  // Use chat's worktreePath if available, otherwise fall back to project path
  const effectivePath = chatData?.worktreePath || selectedProject?.path

  // Task count for auto-collapse logic
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const todosAtom = useMemo(
    () => currentTodosAtomFamily(activeSubChatId || "default"),
    [activeSubChatId]
  )
  const [todoState] = useAtom(todosAtom)
  const taskCount = todoState.todos.length
  const completedCount = todoState.todos.filter((t) => t.status === "completed").length

  // Artifacts count
  const artifactsCount = useArtifactsCount()

  // Section expand states
  const [taskExpanded, setTaskExpanded] = useAtom(taskSectionExpandedAtom)
  const [artifactsExpanded, setArtifactsExpanded] = useAtom(artifactsSectionExpandedAtom)

  // Compute effective expanded state (auto logic when null)
  const isTaskExpanded = taskExpanded === null ? taskCount > 0 : taskExpanded
  const isArtifactsExpanded = artifactsExpanded === null ? artifactsCount > 0 : artifactsExpanded

  // File preview
  const setFilePreviewPath = useSetAtom(filePreviewPathAtom)

  // Handle file selection from file tree (relative path)
  const handleFileTreeSelect = useCallback(
    (relativePath: string) => {
      // Convert relative path to absolute path
      const absolutePath = effectivePath
        ? `${effectivePath}/${relativePath}`
        : relativePath
      setFilePreviewPath(absolutePath)
    },
    [effectivePath, setFilePreviewPath]
  )

  // Handle file selection from artifacts (already absolute path)
  const handleArtifactSelect = useCallback(
    (absolutePath: string) => {
      setFilePreviewPath(absolutePath)
    },
    [setFilePreviewPath]
  )

  const handleToggleTask = () => {
    // Switch from auto to manual mode, or toggle manual mode
    if (taskExpanded === null) {
      // Currently auto - switch to opposite of current effective state
      setTaskExpanded(!isTaskExpanded)
    } else {
      setTaskExpanded(!taskExpanded)
    }
  }

  const handleToggleArtifacts = () => {
    if (artifactsExpanded === null) {
      setArtifactsExpanded(!isArtifactsExpanded)
    } else {
      setArtifactsExpanded(!artifactsExpanded)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Three collapsible sections */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Section 1: Tasks (collapsible) */}
        <CollapsibleSection
          title="Tasks"
          icon={<ListTodo className="h-3.5 w-3.5 text-muted-foreground" />}
          badge={
            taskCount > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {completedCount}/{taskCount}
              </span>
            ) : null
          }
          isExpanded={isTaskExpanded}
          onToggle={handleToggleTask}
          className={isTaskExpanded ? "flex-shrink-0 max-h-[35%]" : "flex-shrink-0"}
        >
          <div className="h-full overflow-auto">
            <TaskPanelContent />
          </div>
        </CollapsibleSection>

        {/* Section 2: Artifacts (collapsible) */}
        <CollapsibleSection
          title="Artifacts"
          icon={<Package className="h-3.5 w-3.5 text-muted-foreground" />}
          badge={
            artifactsCount > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {artifactsCount} {artifactsCount === 1 ? "file" : "files"}
              </span>
            ) : null
          }
          isExpanded={isArtifactsExpanded}
          onToggle={handleToggleArtifacts}
          className={isArtifactsExpanded ? "flex-shrink-0 max-h-[35%]" : "flex-shrink-0"}
        >
          <div className="h-full overflow-auto">
            <ArtifactsPanelContent onFileSelect={handleArtifactSelect} />
          </div>
        </CollapsibleSection>

        {/* Section 3: File Tree (always expanded, takes remaining space) */}
        <div className="flex-1 min-h-[100px] overflow-hidden border-t">
          <FileTreePanel
            projectPath={effectivePath}
            onFileSelect={handleFileTreeSelect}
            showHeader={true}
          />
        </div>
      </div>
    </div>
  )
}
