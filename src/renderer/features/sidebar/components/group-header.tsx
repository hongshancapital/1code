"use client"

import React, { memo, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react"
import * as LucideIcons from "lucide-react"
import { cn } from "../../../lib/utils"
import { GroupIndexPopover } from "./group-index-popover"

export interface GroupInfo {
  id: string
  title: string
  count: number
  color?: string
  icon?: string
  isPresetTag?: boolean // true for preset tags like "red", "orange"
}

// Get Lucide icon component by name (same as in tag-selector-submenu.tsx)
function getIconComponent(iconName: string): LucideIcons.LucideIcon {
  const pascalCase = iconName
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")
  return (LucideIcons as unknown as Record<string, LucideIcons.LucideIcon>)[pascalCase] || LucideIcons.Tag
}

interface GroupHeaderProps {
  group: GroupInfo
  isCollapsed: boolean
  onToggleCollapse: (groupId: string) => void
  /** All groups for the index popover */
  allGroups?: GroupInfo[]
  /** Called when a group is selected from the index */
  onGroupSelect?: (groupId: string) => void
  /** Current group mode */
  groupMode?: "folder" | "tag"
}

export const GroupHeader = memo(function GroupHeader({
  group,
  isCollapsed,
  onToggleCollapse,
  allGroups,
  onGroupSelect,
  groupMode = "folder",
}: GroupHeaderProps) {
  const [indexOpen, setIndexOpen] = useState(false)

  const handleCollapseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onToggleCollapse(group.id)
    },
    [onToggleCollapse, group.id],
  )

  const handleGripClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (allGroups && onGroupSelect) {
        setIndexOpen(true)
      }
    },
    [allGroups, onGroupSelect],
  )

  const handleGroupSelect = useCallback(
    (groupId: string) => {
      onGroupSelect?.(groupId)
      setIndexOpen(false)
    },
    [onGroupSelect],
  )

  // Handle click on the whole header (excluding buttons) - toggle collapse
  const handleHeaderClick = useCallback(() => {
    onToggleCollapse(group.id)
  }, [onToggleCollapse, group.id])

  const { t } = useTranslation("sidebar")

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 cursor-pointer",
        "hover:bg-foreground/5 rounded-md transition-colors",
        "select-none group/header",
      )}
      onClick={handleHeaderClick}
    >
      {/* Collapse/expand chevron */}
      <button
        className="p-0.5 hover:bg-foreground/10 rounded transition-colors"
        onClick={handleCollapseClick}
        aria-label={isCollapsed ? t("grouping.expandGroup") : t("grouping.collapseGroup")}
      >
        {isCollapsed ? (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        )}
      </button>

      {/* Tag icon - for tag groups show colored icon, for folder groups show title only */}
      {groupMode === "tag" && group.color && group.icon && (
        <div
          className="w-5 h-5 rounded flex items-center justify-center shrink-0"
          style={{ backgroundColor: group.color }}
        >
          {(() => {
            const IconComponent = getIconComponent(group.icon)
            return <IconComponent className="w-3 h-3 text-white" />
          })()}
        </div>
      )}
      {/* For non-tag groups or tags without color, show icon without background */}
      {groupMode === "tag" && !group.color && group.icon && (
        <div className="w-5 h-5 flex items-center justify-center shrink-0 text-muted-foreground">
          {(() => {
            const IconComponent = getIconComponent(group.icon)
            return <IconComponent className="w-3 h-3" />
          })()}
        </div>
      )}

      {/* Group title - only show for folder groups, NOT for tag groups */}
      {groupMode !== "tag" && group.title && (
        <span className="text-xs font-medium text-muted-foreground flex-1 truncate">
          {group.title}
        </span>
      )}
      {/* Spacer when in tag mode (no title shown) */}
      {groupMode === "tag" && <div className="flex-1" />}

      {/* Count */}
      <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
        {group.count}
      </span>

      {/* Grip button for quick navigation - shows on hover */}
      {allGroups && onGroupSelect && (
        <GroupIndexPopover
          open={indexOpen}
          onOpenChange={setIndexOpen}
          groups={allGroups}
          onGroupSelect={handleGroupSelect}
          mode={groupMode}
        >
          <button
            className={cn(
              "p-0.5 rounded opacity-0 group-hover/header:opacity-100",
              "hover:bg-foreground/10 transition-opacity",
              "text-muted-foreground hover:text-foreground",
            )}
            onClick={handleGripClick}
            aria-label="快速跳转到分组"
          >
            <GripVertical className="h-3 w-3" />
          </button>
        </GroupIndexPopover>
      )}
    </div>
  )
})
