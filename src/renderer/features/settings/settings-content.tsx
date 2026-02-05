import { useAtomValue, useSetAtom } from "jotai"
import { useEffect } from "react"
import {
  agentsSettingsDialogActiveTabAtom,
  devToolsUnlockedAtom,
} from "../../lib/atoms"
import { desktopViewAtom } from "../agents/atoms"
import { AgentsAppearanceTab } from "../../components/dialogs/settings-tabs/agents-appearance-tab"
import { AgentsBetaTab } from "../../components/dialogs/settings-tabs/agents-beta-tab"
import { AgentsCustomAgentsTab } from "../../components/dialogs/settings-tabs/agents-custom-agents-tab"
import { AgentsDebugTab } from "../../components/dialogs/settings-tabs/agents-debug-tab"
import { AgentsKeyboardTab } from "../../components/dialogs/settings-tabs/agents-keyboard-tab"
import { AgentsMcpTab } from "../../components/dialogs/settings-tabs/agents-mcp-tab"
import { AgentsModelsTab } from "../../components/dialogs/settings-tabs/agents-models-tab"
import { AgentsPreferencesTab } from "../../components/dialogs/settings-tabs/agents-preferences-tab"
import { AgentsProfileTab } from "../../components/dialogs/settings-tabs/agents-profile-tab"
import { AgentsProjectsTab } from "../../components/dialogs/settings-tabs/agents-project-worktree-tab"
import { AgentsSkillsTab } from "../../components/dialogs/settings-tabs/agents-skills-tab"
import { AgentsCommandsTab } from "../../components/dialogs/settings-tabs/agents-commands-tab"
import { AgentsPluginsTab } from "../../components/dialogs/settings-tabs/agents-plugins-tab"
import { FilePreviewDialog } from "../cowork/file-preview/file-preview-dialog"
import { AgentsRuntimeTab } from "../../components/dialogs/settings-tabs/agents-runtime-tab"

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV

export function SettingsContent() {
  const activeTab = useAtomValue(agentsSettingsDialogActiveTabAtom)
  const devToolsUnlocked = useAtomValue(devToolsUnlockedAtom)
  const showDebugTab = isDevelopment || devToolsUnlocked
  const setDesktopView = useSetAtom(desktopViewAtom)

  // Escape key closes settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setDesktopView(null)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [setDesktopView])

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return <AgentsProfileTab />
      case "appearance":
        return <AgentsAppearanceTab />
      case "keyboard":
        return <AgentsKeyboardTab />
      case "preferences":
        return <AgentsPreferencesTab />
      case "models":
        return <AgentsModelsTab />
      case "skills":
        return <AgentsSkillsTab />
      case "commands":
        return <AgentsCommandsTab />
      case "agents":
        return <AgentsCustomAgentsTab />
      case "mcp":
        return <AgentsMcpTab />
      case "plugins":
        return <AgentsPluginsTab />
      case "projects":
        return <AgentsProjectsTab />
      case "beta":
        return <AgentsBetaTab />
      case "runtime":
        return <AgentsRuntimeTab />
      case "debug":
        return showDebugTab ? <AgentsDebugTab /> : null
      default:
        return null
    }
  }

  // Two-panel tabs need full width and height, no scroll wrapper
  const isTwoPanelTab = activeTab === "mcp" || activeTab === "skills" || activeTab === "commands" || activeTab === "agents" || activeTab === "projects" || activeTab === "keyboard" || activeTab === "plugins"

  if (isTwoPanelTab) {
    return (
      <>
        <div className="h-full overflow-hidden">
          {renderTabContent()}
        </div>
        <FilePreviewDialog />
      </>
    )
  }

  return (
    <>
      <div className="h-full overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          {renderTabContent()}
        </div>
      </div>
      <FilePreviewDialog />
    </>
  )
}
