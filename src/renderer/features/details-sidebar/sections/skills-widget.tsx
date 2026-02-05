"use client"

import { useAtomValue, useSetAtom } from "jotai"
import { ChevronDown, Settings, Sparkles } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { trpc } from "../../../lib/trpc"
import {
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  sessionInfoAtom,
} from "../../../lib/atoms"
import { selectedProjectAtom } from "../../agents/atoms"
import { pendingMentionAtom } from "../../agents/atoms"
import { cn } from "../../../lib/utils"
import { WIDGET_REGISTRY } from "../atoms"

/**
 * Format skill name for display
 * Converts kebab-case to Title Case
 */
function formatSkillName(name: string): string {
  // Remove builtin- prefix if present
  const cleanName = name.replace(/^builtin-/, "")
  return cleanName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Get source badge color class
 * builtin uses blue to match settings page style
 */
function getSourceBadgeClass(source: string): string {
  switch (source) {
    case "project":
      return "bg-emerald-500/10 text-emerald-500"
    case "user":
      return "bg-green-500/10 text-green-500"
    case "plugin":
      return "bg-purple-500/10 text-purple-500"
    case "builtin":
      return "bg-blue-500/10 text-blue-500"
    default:
      return "bg-muted text-muted-foreground"
  }
}

/**
 * Source type for i18n key mapping
 */
type SkillSource = "project" | "user" | "plugin" | "builtin"

/**
 * Check if source is a known skill source
 */
function isKnownSource(source: string): source is SkillSource {
  return ["project", "user", "plugin", "builtin"].includes(source)
}

export const SkillsWidget = memo(function SkillsWidget() {
  const { t } = useTranslation("sidebar")
  const sessionInfo = useAtomValue(sessionInfoAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setPendingMention = useSetAtom(pendingMentionAtom)
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set())

  // Query enabled skills from tRPC
  const { data: skills = [] } = trpc.skills.listEnabled.useQuery(
    { cwd: selectedProject?.path },
    {
      // Cache for 5 minutes
      staleTime: 5 * 60 * 1000,
    }
  )

  const openSkillsSettings = useCallback(() => {
    setSettingsTab("skills")
    setSettingsOpen(true)
  }, [setSettingsTab, setSettingsOpen])

  // Group skills by source
  const skillsBySource = useMemo(() => {
    const map = new Map<string, typeof skills>()

    // Define source order: project > user > plugin > builtin
    const sourceOrder = ["project", "user", "plugin", "builtin"]

    for (const source of sourceOrder) {
      map.set(source, [])
    }

    for (const skill of skills) {
      const sourceSkills = map.get(skill.source) || []
      sourceSkills.push(skill)
      map.set(skill.source, sourceSkills)
    }

    // Filter out empty sources and maintain order
    return sourceOrder
      .filter((source) => (map.get(source)?.length ?? 0) > 0)
      .map((source) => ({
        source,
        skills: map.get(source) || [],
      }))
  }, [skills])

  // Also check sessionInfo.skills for SDK-recognized skills
  const sdkSkillsCount = sessionInfo?.skills?.length ?? 0

  if (skills.length === 0) {
    return (
      <div className="px-2 py-2">
        <button
          onClick={openSkillsSettings}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
        >
          <Settings className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" />
          <span>{t("details.skillsWidget.noSkills")}</span>
        </button>
      </div>
    )
  }

  const toggleSource = (source: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  const handleSkillClick = (skillName: string) => {
    setPendingMention({
      id: `skill:${skillName}`,
      label: formatSkillName(skillName),
      path: skillName,
      repository: "",
      truncatedPath: skillName,
      type: "skill",
    })
  }

  // Get maxHeight from widget registry
  const widgetConfig = WIDGET_REGISTRY.find((w) => w.id === "skills")
  const maxHeight = widgetConfig?.maxHeight

  return (
    <div
      className="px-2 py-1.5 flex flex-col gap-0.5 overflow-y-auto"
      style={maxHeight ? { maxHeight } : undefined}
    >
      {skillsBySource.map(({ source, skills: sourceSkills }) => {
        const isExpanded = expandedSources.has(source)
        const hasSkills = sourceSkills.length > 0

        return (
          <div key={source}>
            {/* Source row */}
            <button
              onClick={() => hasSkills && toggleSource(source)}
              className={cn(
                "w-full flex items-center gap-1.5 min-h-[28px] rounded px-1.5 py-0.5 -ml-0.5 transition-colors",
                hasSkills
                  ? "hover:bg-accent cursor-pointer"
                  : "cursor-default"
              )}
            >
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-sm font-medium shrink-0",
                  getSourceBadgeClass(source)
                )}
              >
                {isKnownSource(source) ? t(`details.skillsWidget.sources.${source}`) : source}
              </span>
              <span className="text-xs text-muted-foreground flex-1 text-left">
                {t("details.skillsWidget.skillCount", { count: sourceSkills.length })}
              </span>
              {hasSkills && (
                <ChevronDown
                  className={cn(
                    "h-3 w-3 text-muted-foreground/50 shrink-0 transition-transform duration-150",
                    !isExpanded && "-rotate-90"
                  )}
                />
              )}
            </button>

            {/* Skills list */}
            {isExpanded && hasSkills && (
              <div className="ml-[18px] py-0.5 flex flex-col gap-px">
                {sourceSkills.map((skill) => (
                  <button
                    key={skill.name}
                    onClick={() => handleSkillClick(skill.name)}
                    className="group/skill w-full flex items-start gap-1.5 text-left text-xs py-1 px-1.5 rounded hover:bg-accent transition-colors"
                  >
                    <Sparkles className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-foreground truncate">
                          {formatSkillName(skill.name)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/0 group-hover/skill:text-muted-foreground/50 transition-colors shrink-0">
                          @
                        </span>
                      </div>
                      {skill.description && (
                        <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                          {skill.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})
