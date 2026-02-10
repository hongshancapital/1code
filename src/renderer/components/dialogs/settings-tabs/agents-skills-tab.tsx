import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useListKeyboardNav } from "./use-list-keyboard-nav"
import { useAtomValue } from "jotai"
import { selectedProjectAtom, settingsSkillsSidebarWidthAtom } from "../../../features/agents/atoms"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { Plus, FileText, Image, FileCode, File } from "lucide-react"
import { SkillIcon, MarkdownIcon, CodeIcon } from "../../ui/icons"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"
import { Textarea } from "../../ui/textarea"
import { Button } from "../../ui/button"
import { ResizableSidebar } from "../../ui/resizable-sidebar"
import { ChatMarkdownRenderer } from "../../chat-markdown-renderer"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { Switch } from "../../ui/switch"
import { toast } from "sonner"
import { useFilePreview } from "../../../features/cowork/file-preview/file-preview-dialog"

// Types for skill contents
interface SkillFile {
  name: string
  path: string
  type: "markdown" | "image" | "code" | "yaml" | "other"
  size: string
}

interface SkillDirectory {
  name: string
  files: SkillFile[]
}

interface SkillInterfaceConfig {
  display_name?: string
  short_description?: string
  icon_small?: string
  icon_large?: string
  default_prompt?: string
}

// File type icon component
function FileTypeIcon({ type, className }: { type: SkillFile["type"]; className?: string }) {
  switch (type) {
    case "markdown":
      return <FileText className={className} />
    case "image":
      return <Image className={className} />
    case "code":
    case "yaml":
      return <FileCode className={className} />
    default:
      return <File className={className} />
  }
}

// Skill icon image component
function SkillIconImage({
  skillName,
  iconType,
  className,
  cwd,
}: {
  skillName: string
  iconType: "small" | "large"
  className?: string
  cwd?: string
}) {
  const { data: iconData } = trpc.skills.getIcon.useQuery(
    { skillName, iconType, cwd },
    { staleTime: 1000 * 60 * 5 } // Cache for 5 minutes
  )

  if (!iconData) return null

  // Check if this is an SVG data URL - need to inline it for currentColor to work
  if (iconData.startsWith("data:image/svg+xml")) {
    // Decode the SVG content from data URL
    let svgContent = iconData.startsWith("data:image/svg+xml;base64,")
      ? atob(iconData.replace("data:image/svg+xml;base64,", ""))
      : decodeURIComponent(iconData.replace("data:image/svg+xml,", ""))

    // Add width/height 100% to SVG so it respects container size
    svgContent = svgContent.replace(
      /<svg([^>]*)>/,
      '<svg$1 style="width:100%;height:100%">'
    )

    // Render inline SVG so currentColor inherits from parent
    return (
      <span
        className={cn("inline-flex items-center justify-center [&>svg]:w-full [&>svg]:h-full", className)}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    )
  }

  return <img src={iconData} className={className} alt="" />
}

// --- Detail Panel (Editable) ---
function SkillDetail({
  skill,
  onSave,
  isSaving,
  cwd,
}: {
  skill: {
    name: string
    description: string
    source: "user" | "project" | "plugin" | "builtin"
    path: string
    content: string
    interface?: SkillInterfaceConfig
    iconSmallPath?: string
    iconLargePath?: string
    skillDir?: string
    contents?: SkillDirectory[]
  }
  onSave: (data: { description: string; content: string }) => void
  isSaving: boolean
  cwd?: string
}) {
  const { t } = useTranslation('settings')
  const [description, setDescription] = useState(skill.description)
  const [content, setContent] = useState(skill.content)
  const [viewMode, setViewMode] = useState<"rendered" | "editor">("rendered")

  const { openPreview } = useFilePreview()

  const isReadOnly = skill.source === "builtin" || skill.source === "plugin"

  // Reset local state when skill changes
  useEffect(() => {
    setDescription(skill.description)
    setContent(skill.content)
    setViewMode("rendered")
  }, [skill.name, skill.description, skill.content])

  const hasChanges =
    description !== skill.description ||
    content !== skill.content

  const handleSave = useCallback(() => {
    if (description !== skill.description || content !== skill.content) {
      onSave({ description, content })
    }
  }, [description, content, skill.description, skill.content, onSave])

  const handleBlur = useCallback(() => {
    if (isReadOnly) return
    if (description !== skill.description || content !== skill.content) {
      onSave({ description, content })
    }
  }, [isReadOnly, description, content, skill.description, skill.content, onSave])

  const handleToggleViewMode = useCallback(() => {
    if (isReadOnly) return // Read-only skills stay in rendered mode
    setViewMode((prev) => {
      if (prev === "editor") {
        // Switching from editor to preview — auto-save
        if (description !== skill.description || content !== skill.content) {
          onSave({ description, content })
        }
      }
      return prev === "rendered" ? "editor" : "rendered"
    })
  }, [isReadOnly, description, content, skill.description, skill.content, onSave])

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          {/* Skill Icon */}
          {skill.iconLargePath && (
            <SkillIconImage
              skillName={skill.name}
              iconType="large"
              className="h-12 w-12 rounded-lg shrink-0 object-cover"
              cwd={cwd}
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {skill.interface?.display_name || skill.name}
              </h3>
              {skill.source === "builtin" && (
                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">
                  {t('skills.badges.builtin')}
                </span>
              )}
              {skill.source === "plugin" && (
                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 font-medium">
                  {t('skills.badges.plugin')}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{skill.path}</p>
          </div>
          {hasChanges && !isReadOnly && (
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? t('skills.form.saving') : t('skills.form.save')}
            </Button>
          )}
        </div>

        {/* Read-only notice */}
        {isReadOnly && (
          <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg">
            {skill.source === "builtin" ? t('skills.detail.readOnly.builtin') : t('skills.detail.readOnly.plugin')}
          </div>
        )}

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <Label>{t('skills.detail.description')}</Label>
          <Textarea
            value={description}
            onChange={(e) => !isReadOnly && setDescription(e.target.value)}
            onBlur={handleBlur}
            placeholder={t('skills.detail.descriptionPlaceholder')}
            readOnly={isReadOnly}
            rows={3}
            className={cn("resize-none", isReadOnly ? "bg-muted/30 cursor-default" : "")}
          />
        </div>

        {/* Usage */}
        <div className="flex flex-col gap-1.5">
          <Label>{t('skills.detail.usage')}</Label>
          <div className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg">
            <code className="text-xs text-foreground">@{skill.name}</code>
          </div>
        </div>

        {/* Instructions */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>{t('skills.detail.instructions')}</Label>
            {!isReadOnly && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleToggleViewMode}
                    className="h-6 w-6 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                    aria-label={viewMode === "rendered" ? t('skills.detail.editMarkdown') : t('skills.detail.previewMarkdown')}
                  >
                    <div className="relative w-4 h-4">
                      <MarkdownIcon
                        className={cn(
                          "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out",
                          viewMode === "rendered" ? "opacity-100 scale-100" : "opacity-0 scale-75",
                        )}
                      />
                      <CodeIcon
                        className={cn(
                          "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out",
                          viewMode === "editor" ? "opacity-100 scale-100" : "opacity-0 scale-75",
                        )}
                      />
                    </div>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {viewMode === "rendered" ? t('skills.detail.editMarkdown') : t('skills.detail.previewMarkdown')}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {viewMode === "rendered" || isReadOnly ? (
            <div
              className={cn(
                "rounded-lg border border-border bg-background overflow-hidden px-4 py-3 min-h-[120px] transition-colors",
                !isReadOnly && "cursor-pointer hover:border-foreground/20"
              )}
              onClick={!isReadOnly ? handleToggleViewMode : undefined}
            >
              {content ? (
                <ChatMarkdownRenderer content={content} size="sm" />
              ) : (
                <p className="text-sm text-muted-foreground">{t('skills.detail.noInstructions')}</p>
              )}
            </div>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={handleBlur}
              rows={16}
              className="font-mono resize-y"
              placeholder={t('skills.detail.instructionsPlaceholder')}
              autoFocus
            />
          )}
        </div>

        {/* Default Prompt (if available) */}
        {skill.interface?.default_prompt && (
          <div className="space-y-1.5">
            <Label>{t('skills.detail.defaultPrompt')}</Label>
            <div className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-muted-foreground">
              {skill.interface.default_prompt}
            </div>
          </div>
        )}

        {/* Skill Contents - Sub-directories */}
        {skill.contents && skill.contents.length > 0 && (
          <div className="space-y-3">
            <Label>{t('skills.detail.contents')}</Label>
            {skill.contents.map((dir) => (
              <div key={dir.name} className="space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {dir.name}/
                </p>
                <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {dir.files.map((file) => {
                    // Construct absolute file path from skillDir + file.path
                    const absolutePath = skill.skillDir ? `${skill.skillDir}/${file.path}` : file.path
                    return (
                      <div
                        key={file.path}
                        onClick={() => {
                          console.log("[SkillDetail] Opening preview:", absolutePath)
                          openPreview(absolutePath) // Use dialog mode (default)
                        }}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <FileTypeIcon type={file.type} className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm flex-1 truncate">{file.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{file.size}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// --- Create Form ---
function CreateSkillForm({
  onCreated,
  onCancel,
  isSaving,
  hasProject,
}: {
  onCreated: (data: { name: string; description: string; content: string; source: "user" | "project" }) => void
  onCancel: () => void
  isSaving: boolean
  hasProject: boolean
}) {
  const { t } = useTranslation('settings')
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [content, setContent] = useState("")
  const [source, setSource] = useState<"user" | "project">("user")

  const canSave = name.trim().length > 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{t('skills.form.title')}</h3>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>{t('skills.form.cancel')}</Button>
            <Button size="sm" onClick={() => onCreated({ name, description, content, source })} disabled={!canSave || isSaving}>
              {isSaving ? t('skills.form.creating') : t('skills.form.create')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('skills.form.nameLabel')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('skills.form.namePlaceholder')}
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground">{t('skills.form.nameHint')}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('skills.detail.description')}</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('skills.form.descriptionPlaceholder')}
          />
        </div>

        {hasProject && (
          <div className="flex flex-col gap-1.5">
            <Label>{t('skills.form.scopeLabel')}</Label>
            <Select value={source} onValueChange={(v) => setSource(v as "user" | "project")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{t('skills.form.scopeUser')}</SelectItem>
                <SelectItem value="project">{t('skills.form.scopeProject')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label>{t('skills.detail.instructions')}</Label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            className="font-mono resize-y"
            placeholder={t('skills.detail.instructionsPlaceholder')}
          />
        </div>
      </div>
    </div>
  )
}

// --- Main Component ---
export function AgentsSkillsTab() {
  const { t } = useTranslation('settings')
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddForm, setShowAddForm] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus search on "/" hotkey
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])
  const selectedProject = useAtomValue(selectedProjectAtom)

  const { data: skills = [], isLoading, refetch } = trpc.skills.list.useQuery(
    selectedProject?.path ? { cwd: selectedProject.path } : undefined,
  )

  const { data: enabledSkills = {} } = trpc.claudeSettings.getEnabledSkills.useQuery(
    selectedProject?.path ? { cwd: selectedProject.path } : undefined,
  )

  const updateMutation = trpc.skills.update.useMutation()
  const createMutation = trpc.skills.create.useMutation()
  const setSkillEnabledMutation = trpc.claudeSettings.setSkillEnabled.useMutation()

  const trpcUtils = trpc.useUtils()

  const handleToggleSkillEnabled = useCallback(async (skillName: string, enabled: boolean) => {
    try {
      await setSkillEnabledMutation.mutateAsync({ skillName, enabled })
      await trpcUtils.claudeSettings.getEnabledSkills.invalidate()
      // Invalidate skills queries so widgets update after filesystem sync
      await trpcUtils.skills.listEnabled.invalidate()
      await trpcUtils.skills.list.invalidate()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update"
      toast.error("Failed to update skill", { description: message })
    }
  }, [setSkillEnabledMutation, trpcUtils])

  const isSkillEnabled = useCallback((skillName: string) => {
    // Default to enabled if not explicitly set
    return enabledSkills[skillName] !== false
  }, [enabledSkills])

  const handleCreate = useCallback(async (data: {
    name: string; description: string; content: string; source: "user" | "project"
  }) => {
    try {
      const result = await createMutation.mutateAsync({
        name: data.name,
        description: data.description,
        content: data.content,
        source: data.source,
        cwd: selectedProject?.path,
      })
      toast.success("Skill created", { description: result.name })
      setShowAddForm(false)
      await refetch()
      setSelectedSkillName(result.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create"
      toast.error("Failed to create", { description: message })
    }
  }, [createMutation, selectedProject?.path, refetch])

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills
    const q = searchQuery.toLowerCase()
    return skills.filter((s) =>
      s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    )
  }, [skills, searchQuery])

  const userSkills = filteredSkills.filter((s) => s.source === "user")
  const projectSkills = filteredSkills.filter((s) => s.source === "project")
  const pluginSkills = filteredSkills.filter((s) => s.source === "plugin")
  const builtinSkills = filteredSkills.filter((s) => s.source === "builtin")

  const allSkillNames = useMemo(
    () => [...userSkills, ...projectSkills, ...pluginSkills, ...builtinSkills].map((s) => s.name),
    [userSkills, projectSkills, pluginSkills, builtinSkills]
  )

  const { containerRef: listRef, onKeyDown: listKeyDown } = useListKeyboardNav({
    items: allSkillNames,
    selectedItem: selectedSkillName,
    onSelect: setSelectedSkillName,
  })

  const selectedSkill = skills.find((s) => s.name === selectedSkillName) || null

  // Auto-select first skill when data loads
  useEffect(() => {
    if (selectedSkillName || isLoading || skills.length === 0) return
    setSelectedSkillName(skills[0]!.name)
  }, [skills, selectedSkillName, isLoading])

  const handleSave = useCallback(async (
    skill: { name: string; path: string; source: "user" | "project" | "plugin" | "builtin" },
    data: { description: string; content: string },
  ) => {
    // Plugin and builtin skills are read-only
    if (skill.source === "plugin" || skill.source === "builtin") {
      toast.error("Cannot modify this skill", { description: `${skill.source === "builtin" ? "Built-in" : "Plugin"} skills are read-only` })
      return
    }
    try {
      await updateMutation.mutateAsync({
        path: skill.path,
        name: skill.name,
        description: data.description,
        content: data.content,
        cwd: selectedProject?.path,
      })
      toast.success("Skill saved", { description: skill.name })
      await refetch()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save"
      toast.error("Failed to save", { description: message })
    }
  }, [updateMutation, selectedProject?.path, refetch])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar - skill list */}
      <ResizableSidebar
        isOpen={true}
        onClose={() => {}}
        widthAtom={settingsSkillsSidebarWidthAtom}
        minWidth={200}
        maxWidth={400}
        side="left"
        animationDuration={0}
        initialWidth={240}
        exitWidth={240}
        disableClickToClose={true}
      >
        <div className="flex flex-col h-full bg-background border-r overflow-hidden" style={{ borderRightWidth: "0.5px" }}>
          {/* Search + Add */}
          <div className="px-2 pt-2 shrink-0 flex items-center gap-1.5">
            <input
              ref={searchInputRef}
              placeholder={t('skills.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={listKeyDown}
              className="h-7 w-full rounded-lg text-sm bg-muted border border-input px-3 placeholder:text-muted-foreground/40 outline-hidden"
            />
            <button
              onClick={() => { setShowAddForm(true); setSelectedSkillName(null) }}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
              title={t('skills.createTooltip')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {/* Skill list */}
          <div ref={listRef} onKeyDown={listKeyDown} tabIndex={-1} className="flex-1 overflow-y-auto px-2 pt-2 pb-2 outline-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-muted-foreground">{t('skills.loading')}</p>
              </div>
            ) : skills.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <SkillIcon className="h-8 w-8 text-border mb-3" />
                <p className="text-sm text-muted-foreground mb-1">{t('skills.emptyState')}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  {t('skills.createFirst')}
                </Button>
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">{t('skills.noResults')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* User Skills */}
                {userSkills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {t('skills.sections.user')}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {userSkills.map((skill) => {
                        const isSelected = selectedSkillName === skill.name
                        const enabled = isSkillEnabled(skill.name)
                        const displayName = skill.interface?.display_name || skill.name
                        return (
                          <div
                            key={skill.name}
                            data-item-id={skill.name}
                            onClick={() => setSelectedSkillName(skill.name)}
                            className={cn(
                              "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
                              isSelected
                                ? "bg-foreground/5 text-foreground"
                                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                              !enabled && "opacity-50"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className={cn("text-sm truncate flex-1", !enabled && "line-through")}>{displayName}</span>
                              <Switch
                                checked={enabled}
                                onCheckedChange={(checked) => handleToggleSkillEnabled(skill.name, checked)}
                                onClick={(e) => e.stopPropagation()}
                                className="scale-75"
                              />
                            </div>
                            {skill.description && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                {skill.description}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Project Skills */}
                {projectSkills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {t('skills.sections.project')}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {projectSkills.map((skill) => {
                        const isSelected = selectedSkillName === skill.name
                        const enabled = isSkillEnabled(skill.name)
                        const displayName = skill.interface?.display_name || skill.name
                        return (
                          <div
                            key={skill.name}
                            data-item-id={skill.name}
                            onClick={() => setSelectedSkillName(skill.name)}
                            className={cn(
                              "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
                              isSelected
                                ? "bg-foreground/5 text-foreground"
                                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                              !enabled && "opacity-50"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className={cn("text-sm truncate flex-1", !enabled && "line-through")}>{displayName}</span>
                              <Switch
                                checked={enabled}
                                onCheckedChange={(checked) => handleToggleSkillEnabled(skill.name, checked)}
                                onClick={(e) => e.stopPropagation()}
                                className="scale-75"
                              />
                            </div>
                            {skill.description && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                {skill.description}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Plugin Skills */}
                {pluginSkills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {t('skills.sections.plugin')}
                    </p>
                    <div className="space-y-0.5">
                      {pluginSkills.map((skill) => {
                        const isSelected = selectedSkillName === skill.name
                        const enabled = isSkillEnabled(skill.name)
                        const displayName = skill.interface?.display_name || skill.name
                        return (
                          <div
                            key={skill.name}
                            data-item-id={skill.name}
                            onClick={() => setSelectedSkillName(skill.name)}
                            className={cn(
                              "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
                              isSelected
                                ? "bg-foreground/5 text-foreground"
                                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                              !enabled && "opacity-50"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className={cn("text-sm truncate flex-1", !enabled && "line-through")}>{displayName}</span>
                              <Switch
                                checked={enabled}
                                onCheckedChange={(checked) => handleToggleSkillEnabled(skill.name, checked)}
                                onClick={(e) => e.stopPropagation()}
                                className="scale-75"
                              />
                            </div>
                            {skill.description && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                {skill.description}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Built-in Skills */}
                {builtinSkills.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {t('skills.sections.builtin')}
                    </p>
                    <div className="space-y-0.5">
                      {builtinSkills.map((skill) => {
                        const isSelected = selectedSkillName === skill.name
                        const enabled = isSkillEnabled(skill.name)
                        const displayName = skill.interface?.display_name || skill.name
                        return (
                          <div
                            key={skill.name}
                            data-item-id={skill.name}
                            onClick={() => setSelectedSkillName(skill.name)}
                            className={cn(
                              "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
                              isSelected
                                ? "bg-foreground/5 text-foreground"
                                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                              !enabled && "opacity-50"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className={cn("text-sm truncate flex-1", !enabled && "line-through")}>{displayName}</span>
                              <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">
                                {t('skills.badges.builtin')}
                              </span>
                              <Switch
                                checked={enabled}
                                onCheckedChange={(checked) => handleToggleSkillEnabled(skill.name, checked)}
                                onClick={(e) => e.stopPropagation()}
                                className="scale-75"
                              />
                            </div>
                            {skill.description && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                {skill.description}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </ResizableSidebar>

      {/* Right content - detail panel */}
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {showAddForm ? (
          <CreateSkillForm
            onCreated={handleCreate}
            onCancel={() => setShowAddForm(false)}
            isSaving={createMutation.isPending}
            hasProject={!!selectedProject?.path}
          />
        ) : selectedSkill ? (
          <SkillDetail
            skill={selectedSkill}
            onSave={(data) => handleSave(selectedSkill, data)}
            isSaving={updateMutation.isPending}
            cwd={selectedProject?.path}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <SkillIcon className="h-12 w-12 text-border mb-4" />
            <p className="text-sm text-muted-foreground">
              {skills.length > 0
                ? t('skills.selectToView')
                : t('skills.noSkillsFound')}
            </p>
            {skills.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {t('skills.createFirst')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
