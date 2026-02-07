import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ChevronLeft } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  EyeOpenFilledIcon,
  ProfileIconFilled,
  SlidersFilledIcon,
} from "../../icons"
import {
  agentsSettingsDialogActiveTabAtom,
  betaMemoryEnabledAtom,
  devToolsUnlockedAtom,
  isDesktopAtom,
  type SettingsTab,
} from "../../lib/atoms"
import {
  setTrafficLightRequestAtom,
  removeTrafficLightRequestAtom,
  TRAFFIC_LIGHT_PRIORITIES,
} from "../../lib/atoms/traffic-light"
import { cn } from "../../lib/utils"
import {
  BugFilledIcon,
  CustomAgentIconFilled,
  FlaskFilledIcon,
  FolderFilledIcon,
  KeyboardFilledIcon,
  OriginalMCPIcon,
  PluginFilledIcon,
  SkillIconFilled,
  TerminalFilledIcon,
  ToolsIconFilled,
} from "../../components/ui/icons"
import { Play, Brain, BrainCircuit } from "lucide-react"
import { desktopViewAtom } from "../agents/atoms"

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV

// Clicks required to unlock devtools in production
const DEVTOOLS_UNLOCK_CLICKS = 5

// Tab definitions with translation keys
type TabDefinition = {
  id: SettingsTab
  labelKey: string
  icon: React.ComponentType<{ className?: string }> | any
}

// General settings tabs (user preferences)
const MAIN_TAB_DEFS: TabDefinition[] = [
  { id: "profile", labelKey: "sidebar.profile", icon: ProfileIconFilled },
  { id: "preferences", labelKey: "sidebar.preferences", icon: SlidersFilledIcon },
  { id: "appearance", labelKey: "sidebar.appearance", icon: EyeOpenFilledIcon },
  { id: "keyboard", labelKey: "sidebar.keyboard", icon: KeyboardFilledIcon },
]

// Project-related tabs (projects, models, runtime)
const PROJECT_TAB_DEFS: TabDefinition[] = [
  { id: "projects", labelKey: "sidebar.projects", icon: FolderFilledIcon },
  { id: "models", labelKey: "sidebar.models", icon: BrainCircuit },
  { id: "runtime" as SettingsTab, labelKey: "sidebar.runtime", icon: Play },
]

// Extension tabs (skills, commands, mcp, agents, plugins)
const EXTENSION_TAB_DEFS: TabDefinition[] = [
  { id: "skills", labelKey: "sidebar.skills", icon: SkillIconFilled },
  { id: "commands" as SettingsTab, labelKey: "sidebar.commands", icon: TerminalFilledIcon },
  { id: "mcp", labelKey: "sidebar.mcpServers", icon: OriginalMCPIcon },
  { id: "agents", labelKey: "sidebar.customAgents", icon: CustomAgentIconFilled },
  { id: "plugins", labelKey: "sidebar.plugins", icon: PluginFilledIcon },
]

// Tools tab (dev only)
const TOOLS_TAB_DEF: TabDefinition = {
  id: "tools" as SettingsTab,
  labelKey: "sidebar.tools",
  icon: ToolsIconFilled,
}

// Advanced/experimental tabs
const ADVANCED_TAB_DEFS: TabDefinition[] = [
  { id: "memory", labelKey: "sidebar.memory", icon: Brain },
  { id: "beta", labelKey: "sidebar.beta", icon: FlaskFilledIcon },
]

// Debug tab definition
const DEBUG_TAB_DEF: TabDefinition = {
  id: "debug",
  labelKey: "sidebar.debug",
  icon: BugFilledIcon,
}

interface TabButtonProps {
  tab: TabDefinition
  label: string
  isActive: boolean
  onClick: () => void
}

function TabButton({ tab, label, isActive, onClick }: TabButtonProps) {
  const Icon = tab.icon
  const isProjectTab = "projectId" in tab

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center whitespace-nowrap transition-colors duration-75 cursor-pointer w-full justify-start gap-2 text-left px-3 py-1.5 text-sm h-7 rounded-md",
        "outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70",
        isActive
          ? "bg-foreground/5 text-foreground font-medium"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground font-medium"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4",
          isProjectTab ? "opacity-100" : isActive ? "opacity-100" : "opacity-50"
        )}
      />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}

export function SettingsSidebar() {
  const { t } = useTranslation("settings")
  const [activeTab, setActiveTab] = useAtom(agentsSettingsDialogActiveTabAtom)
  const [devToolsUnlocked, setDevToolsUnlocked] = useAtom(devToolsUnlockedAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const isDesktop = useAtomValue(isDesktopAtom)

  // Hide native traffic lights when settings sidebar is shown
  const setTrafficLightRequest = useSetAtom(setTrafficLightRequestAtom)
  const removeTrafficLightRequest = useSetAtom(removeTrafficLightRequestAtom)

  useEffect(() => {
    if (!isDesktop) return

    setTrafficLightRequest({
      requester: "settings-sidebar",
      visible: false,
      priority: TRAFFIC_LIGHT_PRIORITIES.SETTINGS_SIDEBAR,
    })

    return () => removeTrafficLightRequest("settings-sidebar")
  }, [isDesktop, setTrafficLightRequest, removeTrafficLightRequest])

  // Beta tab click counter for unlocking devtools
  const betaClickCountRef = useRef(0)
  const betaClickTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Show debug tab if in development OR if devtools are unlocked
  const showDebugTab = isDevelopment || devToolsUnlocked

  // Show tools tab only in development mode
  const showToolsTab = isDevelopment

  const betaMemoryEnabled = useAtomValue(betaMemoryEnabledAtom)

  // Extension tabs with conditional tools tab
  const extensionTabs = useMemo(() => {
    if (showToolsTab) return [...EXTENSION_TAB_DEFS, TOOLS_TAB_DEF]
    return EXTENSION_TAB_DEFS
  }, [showToolsTab])

  const advancedTabs = useMemo(() => {
    const tabs = betaMemoryEnabled
      ? ADVANCED_TAB_DEFS
      : ADVANCED_TAB_DEFS.filter((t) => t.id !== "memory")
    if (showDebugTab) return [...tabs, DEBUG_TAB_DEF]
    return tabs
  }, [showDebugTab, betaMemoryEnabled])

  const handleTabClick = (tabId: SettingsTab) => {
    // Handle Beta tab clicks for devtools unlock
    if (tabId === "beta" && !devToolsUnlocked) {
      betaClickCountRef.current++
      if (betaClickTimeoutRef.current) {
        clearTimeout(betaClickTimeoutRef.current)
      }
      betaClickTimeoutRef.current = setTimeout(() => {
        betaClickCountRef.current = 0
      }, 2000)
      if (betaClickCountRef.current >= DEVTOOLS_UNLOCK_CLICKS) {
        setDevToolsUnlocked(true)
        betaClickCountRef.current = 0
        window.desktopApi?.unlockDevTools()
      }
    }
    setActiveTab(tabId)
  }

  const handleBack = useCallback(() => {
    setDesktopView(null)
  }, [setDesktopView])

  return (
    <div className="flex flex-col h-full bg-tl-background" data-sidebar-content>
      {/* Back button */}
      <div className="px-2 pt-3 pb-2">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm h-7 rounded-md text-muted-foreground hover:text-foreground font-medium transition-colors cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>{t("sidebar.back")}</span>
        </button>
      </div>

      {/* Tab list */}
      <div className="flex flex-col flex-1 overflow-y-auto px-2 pb-4 gap-4">
        {/* Main Tabs (user preferences) */}
        <div className="flex flex-col gap-1">
          {MAIN_TAB_DEFS.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              label={t(tab.labelKey)}
              isActive={activeTab === tab.id}
              onClick={() => handleTabClick(tab.id)}
            />
          ))}
        </div>

        {/* Separator */}
        <div className="border-t border-border/50 mx-2" />

        {/* Project-related Tabs */}
        <div className="flex flex-col gap-1">
          {PROJECT_TAB_DEFS.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              label={t(tab.labelKey)}
              isActive={activeTab === tab.id}
              onClick={() => handleTabClick(tab.id)}
            />
          ))}
        </div>

        {/* Separator */}
        <div className="border-t border-border/50 mx-2" />

        {/* Extension Tabs */}
        <div className="flex flex-col gap-1">
          {extensionTabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              label={t(tab.labelKey)}
              isActive={activeTab === tab.id}
              onClick={() => handleTabClick(tab.id)}
            />
          ))}
        </div>

        {/* Separator */}
        <div className="border-t border-border/50 mx-2" />

        {/* Advanced/Beta Tabs */}
        <div className="flex flex-col gap-1">
          {advancedTabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              label={t(tab.labelKey)}
              isActive={activeTab === tab.id}
              onClick={() => handleTabClick(tab.id)}
            />
          ))}
        </div>

      </div>
    </div>
  )
}
