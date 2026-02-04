"use client"

import { memo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Check, Tag, Plus, type LucideIcon } from "lucide-react"
import * as LucideIcons from "lucide-react"
import {
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../../../components/ui/context-menu"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"

// ============ PRESET TAGS ============
// These are the built-in tags users can choose from
// Each tag is a combination of color + icon

export interface PresetTag {
  id: string
  color: string
  icon: string
}

// Preset tags - color + icon combinations
export const PRESET_TAGS: PresetTag[] = [
  { id: "red", color: "#FF3B30", icon: "tag" },
  { id: "orange", color: "#FF9500", icon: "tag" },
  { id: "yellow", color: "#FFCC00", icon: "tag" },
  { id: "green", color: "#34C759", icon: "tag" },
  { id: "blue", color: "#007AFF", icon: "tag" },
  { id: "purple", color: "#AF52DE", icon: "tag" },
  { id: "pink", color: "#FF2D55", icon: "tag" },
  { id: "gray", color: "#8E8E93", icon: "tag" },
]

// Get Lucide icon component by name
export function getIconComponent(iconName: string): LucideIcon {
  const pascalCase = iconName
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")
  return (LucideIcons as unknown as Record<string, LucideIcon>)[pascalCase] || LucideIcons.Tag
}

// Render a preset tag icon
export function PresetTagIcon({
  tag,
  size = "sm",
  className,
}: {
  tag: PresetTag | null
  size?: "xs" | "sm" | "md" | "sidebar"
  className?: string
}) {
  if (!tag) return null

  const sizeClasses = {
    xs: "w-3 h-3",
    sidebar: "w-4 h-4", // Sidebar size - matches text line height
    sm: "w-5 h-5",
    md: "w-7 h-7",
  }
  const iconSizes = {
    xs: "w-2 h-2",
    sidebar: "w-2.5 h-2.5",
    sm: "w-3 h-3",
    md: "w-4 h-4",
  }

  const IconComponent = getIconComponent(tag.icon)

  return (
    <div
      className={cn(
        sizeClasses[size],
        "rounded flex items-center justify-center shrink-0",
        className,
      )}
      style={{ backgroundColor: tag.color }}
    >
      <IconComponent className={cn(iconSizes[size], "text-white")} />
    </div>
  )
}

// Render a custom tag icon (from database)
export function CustomTagIcon({
  icon,
  color,
  size = "sm",
  className,
}: {
  icon: string | null
  color: string | null
  size?: "xs" | "sm" | "md" | "sidebar"
  className?: string
}) {
  const sizeClasses = {
    xs: "w-3 h-3",
    sidebar: "w-4 h-4", // Sidebar size - matches text line height
    sm: "w-5 h-5",
    md: "w-7 h-7",
  }
  const iconSizes = {
    xs: "w-2 h-2",
    sidebar: "w-2.5 h-2.5",
    sm: "w-3 h-3",
    md: "w-4 h-4",
  }

  const IconComponent = getIconComponent(icon || "tag")

  if (color) {
    return (
      <div
        className={cn(
          sizeClasses[size],
          "rounded flex items-center justify-center shrink-0",
          className,
        )}
        style={{ backgroundColor: color }}
      >
        <IconComponent className={cn(iconSizes[size], "text-white")} />
      </div>
    )
  }

  // No color - just the icon
  return (
    <div
      className={cn(
        sizeClasses[size],
        "flex items-center justify-center shrink-0 text-muted-foreground",
        className,
      )}
    >
      <IconComponent className={iconSizes[size]} />
    </div>
  )
}

// Get preset tag by ID
export function getPresetTag(tagId: string | null): PresetTag | null {
  if (!tagId) return null
  return PRESET_TAGS.find((t) => t.id === tagId) || null
}

// Check if a tag ID is a preset tag
export function isPresetTagId(tagId: string): boolean {
  return PRESET_TAGS.some((t) => t.id === tagId)
}

// ============ TAG SELECTOR SUBMENU ============

interface TagSelectorSubmenuProps {
  /** Current tag ID assigned to the item (single selection) */
  currentTagId: string | null
  /** Called when a tag is selected */
  onTagSelect: (tagId: string | null) => void
  /** Called when "Manage Tags" is clicked */
  onManageTags?: () => void
  /** Optional class name */
  className?: string
  /** Hide preset color tags (for subchats that use M:N table with FK constraint) */
  hidePresetTags?: boolean
}

export const TagSelectorSubmenu = memo(function TagSelectorSubmenu({
  currentTagId,
  onTagSelect,
  onManageTags,
  className,
  hidePresetTags = false,
}: TagSelectorSubmenuProps) {
  const { t } = useTranslation("sidebar")
  // Fetch custom tags from database
  const { data: customTags } = trpc.tags.listTags.useQuery()

  const handleTagClick = useCallback(
    (tagId: string) => {
      // Toggle: if already selected, deselect
      if (currentTagId === tagId) {
        onTagSelect(null)
      } else {
        onTagSelect(tagId)
      }
    },
    [currentTagId, onTagSelect],
  )

  const handleClear = useCallback(() => {
    onTagSelect(null)
  }, [onTagSelect])

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className={className}>
        <Tag className="h-4 w-4 mr-2" />
        {t("tags.title")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="p-2" sideOffset={6} alignOffset={-4}>
        {/* Preset tags in a row - wrapped in ContextMenuItems for proper event handling */}
        {!hidePresetTags && (
          <div className="flex gap-1.5 pb-1">
            {PRESET_TAGS.map((tag) => {
              const isSelected = currentTagId === tag.id
              return (
                <ContextMenuItem
                  key={tag.id}
                  className={cn(
                    "w-7 h-7 p-0 rounded-md flex items-center justify-center transition-all",
                    "hover:scale-110 focus:scale-110",
                    isSelected && "ring-2 ring-primary ring-offset-1",
                  )}
                  style={{ backgroundColor: tag.color }}
                  onSelect={(e) => {
                    e.preventDefault()
                    handleTagClick(tag.id)
                  }}
                >
                  {isSelected ? (
                    <Check className="w-4 h-4 text-white" />
                  ) : (
                    <LucideIcons.Tag className="w-4 h-4 text-white/70" />
                  )}
                </ContextMenuItem>
              )
            })}
          </div>
        )}

        {/* Custom tags from database */}
        {customTags && customTags.length > 0 && (
          <>
            {!hidePresetTags && <ContextMenuSeparator className="my-2" />}
            <div className="flex flex-wrap gap-1.5">
              {customTags.map((tag) => {
                const isSelected = currentTagId === `custom_${tag.id}`
                const IconComponent = getIconComponent(tag.icon || "tag")
                return (
                  <ContextMenuItem
                    key={tag.id}
                    className={cn(
                      "w-7 h-7 p-0 rounded-md flex items-center justify-center transition-all",
                      "hover:scale-110 focus:scale-110",
                      tag.color ? "" : "border border-border",
                      isSelected && "ring-2 ring-primary ring-offset-1",
                    )}
                    style={tag.color ? { backgroundColor: tag.color } : undefined}
                    onSelect={(e) => {
                      e.preventDefault()
                      handleTagClick(`custom_${tag.id}`)
                    }}
                  >
                    {isSelected ? (
                      <Check className={cn("w-4 h-4", tag.color ? "text-white" : "text-primary")} />
                    ) : (
                      <IconComponent className={cn("w-4 h-4", tag.color ? "text-white/70" : "text-muted-foreground")} />
                    )}
                  </ContextMenuItem>
                )
              })}
            </div>
          </>
        )}

        {/* Clear and Manage options */}
        <ContextMenuSeparator className="my-2" />

        {currentTagId && (
          <ContextMenuItem onSelect={() => handleClear()} className="text-muted-foreground">
            {t("tags.clear")}
          </ContextMenuItem>
        )}

        {onManageTags && (
          <ContextMenuItem onSelect={() => onManageTags()}>
            <Plus className="h-4 w-4 mr-2" />
            {t("tags.manage")}
          </ContextMenuItem>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
})

// ============ DROPDOWN MENU VERSION ============

import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../../components/ui/dropdown-menu"

interface TagSelectorDropdownSubmenuProps extends TagSelectorSubmenuProps {}

export const TagSelectorDropdownSubmenu = memo(function TagSelectorDropdownSubmenu({
  currentTagId,
  onTagSelect,
  onManageTags,
  className,
  hidePresetTags = false,
}: TagSelectorDropdownSubmenuProps) {
  const { t } = useTranslation("sidebar")
  const { data: customTags } = trpc.tags.listTags.useQuery()

  const handleTagClick = useCallback(
    (tagId: string) => {
      if (currentTagId === tagId) {
        onTagSelect(null)
      } else {
        onTagSelect(tagId)
      }
    },
    [currentTagId, onTagSelect],
  )

  const handleClear = useCallback(() => {
    onTagSelect(null)
  }, [onTagSelect])

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={className}>
        <Tag className="h-4 w-4 mr-2" />
        {t("tags.title")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="p-2">
        {!hidePresetTags && (
          <div className="flex gap-1.5 pb-1">
            {PRESET_TAGS.map((tag) => {
              const isSelected = currentTagId === tag.id
              return (
                <DropdownMenuItem
                  key={tag.id}
                  className={cn(
                    "w-7 h-7 p-0 rounded-md flex items-center justify-center transition-all",
                    "hover:scale-110 focus:scale-110",
                    isSelected && "ring-2 ring-primary ring-offset-1",
                  )}
                  style={{ backgroundColor: tag.color }}
                  onSelect={(e) => {
                    e.preventDefault()
                    handleTagClick(tag.id)
                  }}
                >
                  {isSelected ? (
                    <Check className="w-4 h-4 text-white" />
                  ) : (
                    <LucideIcons.Tag className="w-4 h-4 text-white/70" />
                  )}
                </DropdownMenuItem>
              )
            })}
          </div>
        )}

        {customTags && customTags.length > 0 && (
          <>
            {!hidePresetTags && <DropdownMenuSeparator className="my-2" />}
            <div className="flex flex-wrap gap-1.5">
              {customTags.map((tag) => {
                const isSelected = currentTagId === `custom_${tag.id}`
                const IconComponent = getIconComponent(tag.icon || "tag")
                return (
                  <DropdownMenuItem
                    key={tag.id}
                    className={cn(
                      "w-7 h-7 p-0 rounded-md flex items-center justify-center transition-all",
                      "hover:scale-110 focus:scale-110",
                      tag.color ? "" : "border border-border",
                      isSelected && "ring-2 ring-primary ring-offset-1",
                    )}
                    style={tag.color ? { backgroundColor: tag.color } : undefined}
                    onSelect={(e) => {
                      e.preventDefault()
                      handleTagClick(`custom_${tag.id}`)
                    }}
                  >
                    {isSelected ? (
                      <Check className={cn("w-4 h-4", tag.color ? "text-white" : "text-primary")} />
                    ) : (
                      <IconComponent className={cn("w-4 h-4", tag.color ? "text-white/70" : "text-muted-foreground")} />
                    )}
                  </DropdownMenuItem>
                )
              })}
            </div>
          </>
        )}

        <DropdownMenuSeparator className="my-2" />

        {currentTagId && (
          <DropdownMenuItem onSelect={() => handleClear()} className="text-muted-foreground">
            {t("tags.clear")}
          </DropdownMenuItem>
        )}

        {onManageTags && (
          <DropdownMenuItem onSelect={() => onManageTags()}>
            <Plus className="h-4 w-4 mr-2" />
            {t("tags.manage")}
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
})
