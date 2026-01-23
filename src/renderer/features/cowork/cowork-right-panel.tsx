import { useMemo, useCallback } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ListTodo, Package } from "lucide-react"
import { selectedProjectAtom, currentTodosAtomFamily } from "../agents/atoms"
import { useAgentSubChatStore } from "../../lib/stores/sub-chat-store"

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
      const absolutePath = selectedProject?.path
        ? `${selectedProject.path}/${relativePath}`
        : relativePath
      setFilePreviewPath(absolutePath)
    },
    [selectedProject?.path, setFilePreviewPath]
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
          title="任务"
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
          title="交付物"
          icon={<Package className="h-3.5 w-3.5 text-muted-foreground" />}
          badge={
            artifactsCount > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {artifactsCount} 个文件
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
            projectPath={selectedProject?.path}
            onFileSelect={handleFileTreeSelect}
            showHeader={true}
          />
        </div>
      </div>
    </div>
  )
}
