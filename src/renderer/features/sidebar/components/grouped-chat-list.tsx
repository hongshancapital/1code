"use client"

import React, { memo, useMemo, useCallback, useRef } from "react"
import { useAtom, useAtomValue } from "jotai"
import { trpc } from "../../../lib/trpc"
import {
  workspaceGroupModeAtom,
  workspaceCollapsedGroupsAtom,
} from "../../../lib/atoms"
import { GroupHeader, type GroupInfo } from "./group-header"
import { cn } from "../../../lib/utils"
import { PRESET_TAGS, getPresetTag, isPresetTagId } from "./tag-selector-submenu"

// Type for chat items - matches the unified chat type in agents-sidebar
export interface GroupedChatItem {
  id: string
  name: string | null
  createdAt: Date | null
  updatedAt: Date | null
  archivedAt: Date | null
  projectId: string | null
  worktreePath: string | null
  branch: string | null
  baseBranch: string | null
  prUrl: string | null
  prNumber: number | null
  tagId: string | null  // Single tag ID (preset like "red" or custom like "custom_xxx")
  sandboxId?: string | null
  isRemote: boolean
  meta?: { repository?: string; branch?: string | null } | null
  remoteStats?: { fileCount: number; additions: number; deletions: number; totalTokens: number } | null
}

// Project info type
export interface ProjectInfo {
  gitOwner?: string | null
  gitProvider?: string | null
  gitRepo?: string | null
  name?: string | null
  mode?: string | null
  path?: string
}

interface GroupedChatListProps {
  /** Unpinned chats to group (Pin 的内容不参与分组) */
  chats: GroupedChatItem[]
  /** Projects map for folder grouping */
  projectsMap: Map<string, ProjectInfo>
  /** Function to render chat items for a group */
  renderGroupChats: (chats: GroupedChatItem[], groupId: string) => React.ReactNode
  /** Optional: Title for "ungrouped" section (default: "未分组") */
  ungroupedTitle?: string
  /** Whether in multi-select mode */
  isMultiSelectMode?: boolean
}

// Helper to get parent folder from path
function getParentFolder(path?: string | null): string {
  if (!path) return "其他"
  const parts = path.split("/").filter(Boolean)
  if (parts.length <= 1) return path
  // Return last folder name for readability
  return parts[parts.length - 1] || "其他"
}

export const GroupedChatList = memo(function GroupedChatList({
  chats,
  projectsMap,
  renderGroupChats,
  ungroupedTitle = "未分组",
  isMultiSelectMode = false,
}: GroupedChatListProps) {
  const groupMode = useAtomValue(workspaceGroupModeAtom)
  const [collapsedGroups, setCollapsedGroups] = useAtom(workspaceCollapsedGroupsAtom)

  // Fetch custom tags for displaying custom tag info (only need for custom_ prefixed tags)
  const { data: customTags } = trpc.tags.listTags.useQuery(undefined, {
    enabled: groupMode === "tag",
  })

  // Group chats by folder or tag
  const { groups, groupInfos } = useMemo(() => {
    const groupMap = new Map<string, GroupedChatItem[]>()
    const infoMap = new Map<string, GroupInfo>()

    if (groupMode === "folder") {
      // Group by project folder
      for (const chat of chats) {
        const project = chat.projectId ? projectsMap.get(chat.projectId) : null
        const folderPath = project?.path || null
        const groupId = folderPath || "__other__"
        const groupTitle = getParentFolder(folderPath)

        if (!groupMap.has(groupId)) {
          groupMap.set(groupId, [])
          infoMap.set(groupId, {
            id: groupId,
            title: groupTitle,
            count: 0,
          })
        }
        groupMap.get(groupId)!.push(chat)
      }

      // Update counts
      for (const [id, items] of groupMap) {
        const info = infoMap.get(id)!
        info.count = items.length
      }
    } else if (groupMode === "tag") {
      // Group by tagId field on each chat (single tag per chat)
      const noTagChats: GroupedChatItem[] = []

      for (const chat of chats) {
        const tagId = chat.tagId
        if (!tagId) {
          noTagChats.push(chat)
        } else {
          // Create group info for this tag
          if (!groupMap.has(tagId)) {
            groupMap.set(tagId, [])

            // Get tag info - could be preset or custom tag
            if (isPresetTagId(tagId)) {
              const presetTag = getPresetTag(tagId)
              infoMap.set(tagId, {
                id: tagId,
                title: "", // No title for preset tags - show icon only
                count: 0,
                color: presetTag?.color,
                icon: presetTag?.icon || "tag",
                isPresetTag: true,
              })
            } else if (tagId.startsWith("custom_")) {
              // Custom tag - extract actual ID
              const actualId = tagId.replace("custom_", "")
              const customTag = customTags?.find((t) => t.id === actualId)
              infoMap.set(tagId, {
                id: tagId,
                title: customTag?.name || tagId,
                count: 0,
                color: customTag?.color ?? undefined,
                icon: customTag?.icon || "tag",
                isPresetTag: false,
              })
            } else {
              // Unknown tag format
              infoMap.set(tagId, {
                id: tagId,
                title: tagId,
                count: 0,
              })
            }
          }
          groupMap.get(tagId)!.push(chat)
        }
      }

      // Add "no tag" group if needed
      if (noTagChats.length > 0) {
        groupMap.set("__no_tag__", noTagChats)
        infoMap.set("__no_tag__", {
          id: "__no_tag__",
          title: ungroupedTitle,
          count: noTagChats.length,
        })
      }

      // Update counts
      for (const [id, items] of groupMap) {
        const info = infoMap.get(id)!
        info.count = items.length
      }
    }

    // Sort groups: preset tags first (by PRESET_TAGS order), then custom tags, alphabetically for folders
    const sortedEntries = [...groupMap.entries()].sort(([aId], [bId]) => {
      // Always put "other" / "no tag" at the end
      if (aId === "__other__" || aId === "__no_tag__") return 1
      if (bId === "__other__" || bId === "__no_tag__") return -1

      if (groupMode === "tag") {
        // Sort preset tags by their position in PRESET_TAGS array
        const aIsPreset = isPresetTagId(aId)
        const bIsPreset = isPresetTagId(bId)

        if (aIsPreset && bIsPreset) {
          const aIndex = PRESET_TAGS.findIndex((t) => t.id === aId)
          const bIndex = PRESET_TAGS.findIndex((t) => t.id === bId)
          return aIndex - bIndex
        }

        // Preset tags come before custom tags
        if (aIsPreset) return -1
        if (bIsPreset) return 1

        // Custom tags - sort by sortOrder from database
        if (customTags) {
          const aActualId = aId.replace("custom_", "")
          const bActualId = bId.replace("custom_", "")
          const aTag = customTags.find((t) => t.id === aActualId)
          const bTag = customTags.find((t) => t.id === bActualId)
          if (aTag && bTag) {
            return (aTag.sortOrder ?? 0) - (bTag.sortOrder ?? 0)
          }
        }
      }

      // Alphabetical sort for folders
      const aInfo = infoMap.get(aId)
      const bInfo = infoMap.get(bId)
      return (aInfo?.title || "").localeCompare(bInfo?.title || "", "zh-CN")
    })

    return {
      groups: new Map(sortedEntries),
      groupInfos: infoMap,
    }
  }, [chats, projectsMap, groupMode, customTags, ungroupedTitle])

  // Sort chats within each group by updatedAt DESC
  const sortedGroups = useMemo(() => {
    const result = new Map<string, GroupedChatItem[]>()
    for (const [groupId, items] of groups) {
      const sorted = [...items].sort((a, b) => {
        const aTime = a.updatedAt?.getTime() ?? 0
        const bTime = b.updatedAt?.getTime() ?? 0
        return bTime - aTime
      })
      result.set(groupId, sorted)
    }
    return result
  }, [groups])

  // Toggle group collapse
  const handleToggleCollapse = useCallback(
    (groupId: string) => {
      setCollapsedGroups((prev) => {
        const next = new Set(prev)
        if (next.has(groupId)) {
          next.delete(groupId)
        } else {
          next.add(groupId)
        }
        return next
      })
    },
    [setCollapsedGroups],
  )

  // Group refs for scrolling
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Handle group selection from index popover
  const handleGroupSelect = useCallback(
    (groupId: string) => {
      // Expand group if collapsed
      if (collapsedGroups.has(groupId)) {
        setCollapsedGroups((prev) => {
          const next = new Set(prev)
          next.delete(groupId)
          return next
        })
      }

      // Scroll to group
      const element = groupRefs.current.get(groupId)
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    },
    [collapsedGroups, setCollapsedGroups],
  )

  // Get all group infos for index popover
  const allGroupInfos = useMemo(() => {
    return [...groupInfos.values()]
  }, [groupInfos])

  if (chats.length === 0) {
    return null
  }

  return (
    <>
      {/* Render each group */}
      {[...sortedGroups.entries()].map(([groupId, items]) => {
        const info = groupInfos.get(groupId)
        if (!info) return null

        const isCollapsed = collapsedGroups.has(groupId)

        return (
          <div
            key={groupId}
            ref={(el) => {
              if (el) {
                groupRefs.current.set(groupId, el)
              } else {
                groupRefs.current.delete(groupId)
              }
            }}
            data-group-id={groupId}
            className="mb-2"
          >
            {/* Group Header */}
            <GroupHeader
              group={info}
              isCollapsed={isCollapsed}
              onToggleCollapse={handleToggleCollapse}
              allGroups={allGroupInfos}
              onGroupSelect={handleGroupSelect}
              groupMode={groupMode === "tag" ? "tag" : "folder"}
            />

            {/* Group Items - rendered by parent component */}
            {!isCollapsed && (
              <div className="list-none p-0 m-0">
                {renderGroupChats(items, groupId)}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
})
