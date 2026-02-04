"use client"

import React, { memo, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Folder, Tag, type LucideIcon } from "lucide-react"
import * as LucideIcons from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover"
import { cn } from "../../../lib/utils"
import type { GroupInfo } from "./group-header"

// Get Lucide icon component by name
function getIconComponent(iconName: string): LucideIcon {
  const pascalCase = iconName
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")
  return (LucideIcons as unknown as Record<string, LucideIcon>)[pascalCase] || LucideIcons.Tag
}

interface GroupIndexPopoverProps {
  /** Whether the popover is open */
  open: boolean
  /** Called when open state changes */
  onOpenChange: (open: boolean) => void
  /** List of groups to display */
  groups: GroupInfo[]
  /** Called when a group is selected */
  onGroupSelect: (groupId: string) => void
  /** Current group mode ("folder" or "tag") */
  mode: "folder" | "tag"
  /** Trigger element */
  children: React.ReactNode
}

export const GroupIndexPopover = memo(function GroupIndexPopover({
  open,
  onOpenChange,
  groups,
  onGroupSelect,
  mode,
  children,
}: GroupIndexPopoverProps) {
  const { t } = useTranslation("sidebar")

  const handleGroupClick = useCallback(
    (groupId: string) => {
      onGroupSelect(groupId)
      onOpenChange(false)
    },
    [onGroupSelect, onOpenChange],
  )

  // Sort groups alphabetically
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
  }, [groups])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className={cn("p-0", mode === "folder" ? "w-64" : "w-auto min-w-32")}
        side="bottom"
        align="end"
        sideOffset={4}
      >
        <div className="px-3 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-sm font-medium">
            {mode === "folder" ? (
              <>
                <Folder className="h-4 w-4 text-muted-foreground" />
                {t("grouping.folderGrouping")}
              </>
            ) : (
              <>
                <Tag className="h-4 w-4 text-muted-foreground" />
                {t("grouping.tagGrouping")}
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("grouping.quickJump")}
          </p>
        </div>

        <div className="max-h-64 overflow-y-auto p-2">
          {groups.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-4">
              {t("grouping.noGroups")}
            </div>
          ) : mode === "tag" ? (
            /* Tag mode - compact horizontal layout with just icons */
            <div className="flex flex-wrap gap-1.5">
              {sortedGroups.map((group) => {
                const IconComponent = group.icon ? getIconComponent(group.icon) : Tag
                return (
                  <button
                    key={group.id}
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-1 rounded-md",
                      "hover:bg-foreground/5 transition-colors",
                    )}
                    onClick={() => handleGroupClick(group.id)}
                  >
                    {group.color ? (
                      <div
                        className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                        style={{ backgroundColor: group.color }}
                      >
                        <IconComponent className="w-3 h-3 text-white" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 flex items-center justify-center shrink-0 text-muted-foreground">
                        <IconComponent className="w-3 h-3" />
                      </div>
                    )}
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                      {group.count}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            /* Folder mode - grid layout with titles */
            <div className="grid grid-cols-2 gap-1">
              {sortedGroups.map((group) => (
                <button
                  key={group.id}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md",
                    "hover:bg-foreground/5 transition-colors",
                    "text-left w-full",
                  )}
                  onClick={() => handleGroupClick(group.id)}
                >
                  <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-xs truncate flex-1">{group.title}</span>
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                    {group.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
})
