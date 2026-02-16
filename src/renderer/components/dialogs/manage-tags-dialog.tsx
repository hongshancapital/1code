"use client"

import React, { useState, useCallback, memo } from "react"
import { useAtom } from "jotai"
import {
  // Common
  Tag,
  Star,
  Heart,
  Bookmark,
  Flag,
  Zap,
  Circle,
  Pin,
  Hash,
  AtSign,
  Calendar,
  Search,
  Settings,
  Filter,
  List,
  Grid,
  MoreHorizontal,
  Plus,
  // Status
  Check,
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  Bell,
  BellOff,
  Clock,
  Timer,
  Hourglass,
  CalendarCheck,
  CalendarX,
  CircleCheck,
  CircleX,
  CircleDot,
  CircleAlert,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Lock,
  Eye,
  EyeOff,
  // Work
  Briefcase,
  Building,
  Home,
  User,
  Users,
  UserCheck,
  UserX,
  Mail,
  Phone,
  MessageSquare,
  Send,
  Inbox,
  Archive,
  Trash2,
  FileText,
  File,
  Folder,
  FolderOpen,
  Layers,
  Layout,
  // Development
  Code,
  Terminal,
  Bug,
  GitBranch,
  GitCommit,
  GitPullRequest,
  GitMerge,
  Database,
  Server,
  Cloud,
  Cpu,
  HardDrive,
  Wifi,
  Globe,
  Link,
  ExternalLink,
  Download,
  Upload,
  RefreshCw,
  // Creative
  Palette,
  Paintbrush,
  Pencil,
  PenTool,
  Eraser,
  Scissors,
  Camera,
  Image,
  Video,
  Music,
  Mic,
  Headphones,
  Play,
  Pause,
  Square,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { trpc } from "../../lib/trpc"
import { manageTagsDialogOpenAtom } from "../../lib/atoms"
import { cn } from "../../lib/utils"
import { toast } from "sonner"

// macOS-style color palette (optional selection)
const COLOR_PALETTE = [
  { name: "红色", color: "#FF3B30" },
  { name: "橙色", color: "#FF9500" },
  { name: "黄色", color: "#FFCC00" },
  { name: "绿色", color: "#34C759" },
  { name: "蓝色", color: "#007AFF" },
  { name: "紫色", color: "#AF52DE" },
  { name: "粉色", color: "#FF2D55" },
  { name: "灰色", color: "#8E8E93" },
] as const

// Icon groups with ~20 icons each
const ICON_GROUPS: { name: string; icons: { icon: LucideIcon; name: string }[] }[] = [
  {
    name: "常用",
    icons: [
      { icon: Tag, name: "tag" },
      { icon: Star, name: "star" },
      { icon: Heart, name: "heart" },
      { icon: Bookmark, name: "bookmark" },
      { icon: Flag, name: "flag" },
      { icon: Zap, name: "zap" },
      { icon: Circle, name: "circle" },
      { icon: Pin, name: "pin" },
      { icon: Hash, name: "hash" },
      { icon: AtSign, name: "at-sign" },
      { icon: Bell, name: "bell" },
      { icon: Clock, name: "clock" },
      { icon: Calendar, name: "calendar" },
      { icon: Search, name: "search" },
      { icon: Settings, name: "settings" },
      { icon: Filter, name: "filter" },
      { icon: List, name: "list" },
      { icon: Grid, name: "grid" },
      { icon: MoreHorizontal, name: "more-horizontal" },
      { icon: Plus, name: "plus" },
    ],
  },
  {
    name: "状态",
    icons: [
      { icon: Check, name: "check" },
      { icon: X, name: "x" },
      { icon: AlertTriangle, name: "alert-triangle" },
      { icon: AlertCircle, name: "alert-circle" },
      { icon: Info, name: "info" },
      { icon: CircleCheck, name: "circle-check" },
      { icon: CircleX, name: "circle-x" },
      { icon: CircleDot, name: "circle-dot" },
      { icon: CircleAlert, name: "circle-alert" },
      { icon: ShieldCheck, name: "shield-check" },
      { icon: ShieldAlert, name: "shield-alert" },
      { icon: ShieldX, name: "shield-x" },
      { icon: Lock, name: "lock" },
      { icon: BellOff, name: "bell-off" },
      { icon: Timer, name: "timer" },
      { icon: Hourglass, name: "hourglass" },
      { icon: CalendarCheck, name: "calendar-check" },
      { icon: CalendarX, name: "calendar-x" },
      { icon: Eye, name: "eye" },
      { icon: EyeOff, name: "eye-off" },
    ],
  },
  {
    name: "工作",
    icons: [
      { icon: Briefcase, name: "briefcase" },
      { icon: Building, name: "building" },
      { icon: Home, name: "home" },
      { icon: User, name: "user" },
      { icon: Users, name: "users" },
      { icon: UserCheck, name: "user-check" },
      { icon: UserX, name: "user-x" },
      { icon: Mail, name: "mail" },
      { icon: Phone, name: "phone" },
      { icon: MessageSquare, name: "message-square" },
      { icon: Send, name: "send" },
      { icon: Inbox, name: "inbox" },
      { icon: Archive, name: "archive" },
      { icon: Trash2, name: "trash-2" },
      { icon: FileText, name: "file-text" },
      { icon: File, name: "file" },
      { icon: Folder, name: "folder" },
      { icon: FolderOpen, name: "folder-open" },
      { icon: Layers, name: "layers" },
      { icon: Layout, name: "layout" },
    ],
  },
  {
    name: "开发",
    icons: [
      { icon: Code, name: "code" },
      { icon: Terminal, name: "terminal" },
      { icon: Bug, name: "bug" },
      { icon: GitBranch, name: "git-branch" },
      { icon: GitCommit, name: "git-commit" },
      { icon: GitPullRequest, name: "git-pull-request" },
      { icon: GitMerge, name: "git-merge" },
      { icon: Database, name: "database" },
      { icon: Server, name: "server" },
      { icon: Cloud, name: "cloud" },
      { icon: Cpu, name: "cpu" },
      { icon: HardDrive, name: "hard-drive" },
      { icon: Wifi, name: "wifi" },
      { icon: Globe, name: "globe" },
      { icon: Link, name: "link" },
      { icon: ExternalLink, name: "external-link" },
      { icon: Download, name: "download" },
      { icon: Upload, name: "upload" },
      { icon: RefreshCw, name: "refresh-cw" },
      { icon: Settings, name: "settings-dev" },
    ],
  },
  {
    name: "创意",
    icons: [
      { icon: Palette, name: "palette" },
      { icon: Paintbrush, name: "paintbrush" },
      { icon: Pencil, name: "pencil" },
      { icon: PenTool, name: "pen-tool" },
      { icon: Eraser, name: "eraser" },
      { icon: Scissors, name: "scissors" },
      { icon: Camera, name: "camera" },
      { icon: Image, name: "image" },
      { icon: Video, name: "video" },
      { icon: Music, name: "music" },
      { icon: Mic, name: "mic" },
      { icon: Headphones, name: "headphones" },
      { icon: Play, name: "play" },
      { icon: Pause, name: "pause" },
      { icon: Square, name: "square" },
      { icon: Star, name: "star-creative" },
      { icon: Heart, name: "heart-creative" },
      { icon: Zap, name: "zap-creative" },
      { icon: Layers, name: "layers-creative" },
      { icon: Layout, name: "layout-creative" },
    ],
  },
]

// Flatten all icons for lookup
const ALL_ICONS = ICON_GROUPS.flatMap((g) => g.icons)

// Get icon component by name
function getIconByName(name: string): LucideIcon {
  const found = ALL_ICONS.find((i) => i.name === name)
  return found?.icon || Tag // Default to Tag
}

// Render tag icon
function TagIcon({
  icon,
  color,
  size = "md",
}: {
  icon: string | null
  color: string | null
  size?: "sm" | "md" | "lg" | "xl"
}) {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-10 h-10",
    xl: "w-12 h-12",
  }
  const iconSizeClasses = {
    sm: "w-3.5 h-3.5",
    md: "w-4.5 h-4.5",
    lg: "w-5 h-5",
    xl: "w-6 h-6",
  }

  const IconComponent = getIconByName(icon || "tag")

  // With color background
  if (color) {
    return (
      <div
        className={cn(
          sizeClasses[size],
          "rounded-md flex items-center justify-center",
        )}
        style={{ backgroundColor: color }}
      >
        <IconComponent className={cn(iconSizeClasses[size], "text-white")} />
      </div>
    )
  }

  // Without color - just the icon
  return (
    <div
      className={cn(
        sizeClasses[size],
        "flex items-center justify-center text-muted-foreground",
      )}
    >
      <IconComponent className={iconSizeClasses[size]} />
    </div>
  )
}

export const ManageTagsDialog = memo(function ManageTagsDialog() {
  const { t } = useTranslation("sidebar")
  const [open, setOpen] = useAtom(manageTagsDialogOpenAtom)
  const [selectedColor, setSelectedColor] = useState<string | null>(null)
  const [selectedIcon, setSelectedIcon] = useState<string>("tag") // Default to Tag
  const [activeGroup, setActiveGroup] = useState(0)
  const [editingTagId, setEditingTagId] = useState<string | null>(null) // Track which tag is being edited

  const utils = trpc.useUtils()
  const { data: tags } = trpc.tags.listTags.useQuery()

  const createTagMutation = trpc.tags.createTag.useMutation({
    onSuccess: () => {
      utils.tags.listTags.invalidate()
      utils.tags.getChatTagsBatch.invalidate()
      utils.tags.getSubChatTagsBatch.invalidate()
      // Reset selection after create
      setSelectedColor(null)
      setSelectedIcon("tag")
      toast.success(t("tagManager.tagCreated"))
    },
    onError: (error) => {
      toast.error(`${t("tagManager.createFailed")}: ${error.message}`)
    },
  })

  const updateTagMutation = trpc.tags.updateTag.useMutation({
    onSuccess: () => {
      utils.tags.listTags.invalidate()
      utils.tags.getChatTagsBatch.invalidate()
      utils.tags.getSubChatTagsBatch.invalidate()
      utils.chats.list.invalidate() // Refresh chat list to show updated tags
      // Reset selection after update
      setSelectedColor(null)
      setSelectedIcon("tag")
      setEditingTagId(null)
      toast.success(t("tagManager.tagUpdated"))
    },
    onError: (error) => {
      toast.error(`${t("tagManager.updateFailed")}: ${error.message}`)
    },
  })

  const deleteTagMutation = trpc.tags.deleteTag.useMutation({
    onSuccess: () => {
      utils.tags.listTags.invalidate()
      utils.tags.getChatTagsBatch.invalidate()
      utils.tags.getSubChatTagsBatch.invalidate()
      toast.success(t("tagManager.tagDeleted"))
    },
    onError: (error) => {
      toast.error(`${t("tagManager.deleteFailed")}: ${error.message}`)
    },
  })

  // Handle tag click - select for editing
  const handleTagClick = useCallback(
    (tag: { id: string; color: string | null; icon: string | null }) => {
      setEditingTagId(tag.id)
      setSelectedColor(tag.color)
      setSelectedIcon(tag.icon || "tag")
      // Find the group containing this icon
      const groupIndex = ICON_GROUPS.findIndex((g) =>
        g.icons.some((i) => i.name === (tag.icon || "tag")),
      )
      if (groupIndex !== -1) {
        setActiveGroup(groupIndex)
      }
    },
    [],
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent, tagId: string) => {
      e.stopPropagation() // Prevent triggering tag click
      deleteTagMutation.mutate({ id: tagId })
      // If deleting the currently editing tag, reset edit state
      if (editingTagId === tagId) {
        setEditingTagId(null)
        setSelectedColor(null)
        setSelectedIcon("tag")
      }
    },
    [deleteTagMutation, editingTagId],
  )

  const handleCreate = useCallback(() => {
    // Generate a unique name based on icon and color
    const colorName = COLOR_PALETTE.find((c) => c.color === selectedColor)?.name || ""
    const name = colorName ? `${selectedIcon}-${colorName}` : selectedIcon

    createTagMutation.mutate({
      name,
      color: selectedColor || null,
      icon: selectedIcon,
    })
  }, [selectedColor, selectedIcon, createTagMutation])

  const handleUpdate = useCallback(() => {
    if (!editingTagId) return

    // Generate a unique name based on icon and color
    const colorName = COLOR_PALETTE.find((c) => c.color === selectedColor)?.name || ""
    const name = colorName ? `${selectedIcon}-${colorName}` : selectedIcon

    updateTagMutation.mutate({
      id: editingTagId,
      name,
      color: selectedColor,
      icon: selectedIcon,
    })
  }, [editingTagId, selectedColor, selectedIcon, updateTagMutation])

  const handleCancel = useCallback(() => {
    setEditingTagId(null)
    setSelectedColor(null)
    setSelectedIcon("tag")
  }, [])

  const isPending = createTagMutation.isPending || updateTagMutation.isPending || deleteTagMutation.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-xl">{t("tagManager.title")}</DialogTitle>
          <DialogDescription className="text-sm">
            {t("tagManager.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Current Tags */}
          {tags && tags.length > 0 && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-3">
                {t("tagManager.created")} <span className="text-xs text-muted-foreground/70">（{t("tagManager.clickToEdit")}）</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {tags.map((tag) => (
                  <div key={tag.id} className="group relative">
                    <button
                      className={cn(
                        "relative transition-all",
                        editingTagId === tag.id && "ring-2 ring-primary ring-offset-2 rounded-xl",
                      )}
                      onClick={() => handleTagClick(tag)}
                      disabled={isPending}
                    >
                      <TagIcon icon={tag.icon} color={tag.color} size="xl" />
                    </button>
                    <button
                      className={cn(
                        "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full",
                        "bg-destructive text-destructive-foreground",
                        "flex items-center justify-center",
                        "opacity-0 group-hover:opacity-100 transition-opacity",
                        "hover:bg-destructive/90",
                      )}
                      onClick={(e) => handleDelete(e, tag.id)}
                      disabled={isPending}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          {tags && tags.length > 0 && <div className="border-t border-border" />}

          {/* Color Selection */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-3">
              {t("tagManager.colorOptional")}
            </div>
            <div className="flex gap-3">
              {/* No color option */}
              <button
                className={cn(
                  "w-10 h-10 rounded-lg border-2 border-dashed border-border",
                  "flex items-center justify-center text-muted-foreground",
                  "hover:border-muted-foreground transition-all",
                  selectedColor === null && "ring-2 ring-primary ring-offset-2",
                )}
                onClick={() => setSelectedColor(null)}
              >
                <X className="w-4 h-4" />
              </button>
              {COLOR_PALETTE.map((preset) => (
                <button
                  key={preset.color}
                  className={cn(
                    "w-10 h-10 rounded-lg transition-all",
                    "hover:scale-110",
                    selectedColor === preset.color &&
                      "ring-2 ring-primary ring-offset-2",
                  )}
                  style={{ backgroundColor: preset.color }}
                  onClick={() => setSelectedColor(preset.color)}
                  title={preset.name}
                />
              ))}
            </div>
          </div>

          {/* Icon Group Tabs */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-3">
              {t("tagManager.icon")}
            </div>
            <div className="flex gap-2 mb-4">
              {ICON_GROUPS.map((group, idx) => {
                // Get translated group name
                const groupNameKey = group.name === "常用" ? "common"
                  : group.name === "状态" ? "status"
                  : group.name === "工作" ? "work"
                  : group.name === "开发" ? "dev"
                  : group.name === "创意" ? "creative"
                  : group.name
                return (
                  <button
                    key={group.name}
                    className={cn(
                      "px-4 py-2 text-sm rounded-lg transition-colors font-medium",
                      activeGroup === idx
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    onClick={() => setActiveGroup(idx)}
                  >
                    {t(`tagManager.iconGroups.${groupNameKey}`)}
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-10 gap-2">
              {ICON_GROUPS[activeGroup].icons.map(({ icon: Icon, name }) => (
                <button
                  key={name}
                  className={cn(
                    "w-11 h-11 rounded-lg transition-all",
                    "hover:bg-muted flex items-center justify-center",
                    "text-muted-foreground hover:text-foreground",
                    selectedIcon === name && "bg-primary/20 text-primary ring-2 ring-primary",
                  )}
                  onClick={() => setSelectedIcon(name)}
                >
                  <Icon className="w-5 h-5" />
                </button>
              ))}
            </div>
          </div>

          {/* Preview & Action Buttons */}
          <div className="flex items-center gap-6 pt-4 border-t border-border">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">{t("tagManager.preview")}</span>
              <TagIcon icon={selectedIcon} color={selectedColor} size="xl" />
            </div>
            <div className="flex-1" />
            {editingTagId ? (
              /* Edit mode - show Update and Cancel buttons */
              <div className="flex gap-2">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isPending}
                >
                  {t("tagManager.cancel")}
                </Button>
                <Button
                  size="lg"
                  onClick={handleUpdate}
                  disabled={isPending}
                >
                  {t("tagManager.updateTag")}
                </Button>
              </div>
            ) : (
              /* Create mode - show Add button */
              <Button size="lg" onClick={handleCreate} disabled={isPending}>
                {t("tagManager.addTag")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
})
