import { useAtom } from "jotai"
import { RefreshCw, Check, Loader2, CheckCircle, XCircle } from "lucide-react"
import { useState, useCallback } from "react"
import { toast } from "sonner"
import { Button } from "../../ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { trpc } from "../../../lib/trpc"
import { editorConfigAtom, type EditorId } from "../../../lib/atoms/editor"
import { RuntimeSection } from "./runtime-section"
import { getEditorIcon, GenericEditorIcon } from "../../../icons/editor-icons"

// ============================================================================
// Editor Row Component
// ============================================================================

interface EditorRowProps {
  editor: {
    id: string
    name: string
    command: string
    installed: boolean
    version: string | null
    path: string | null
  }
  isDefault: boolean
  onSetDefault: () => void
}

function EditorRow({ editor, isDefault, onSetDefault }: EditorRowProps) {
  const EditorIcon = getEditorIcon(editor.id)

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <EditorIcon className="h-4 w-4 text-muted-foreground" />
          {editor.installed ? (
            <CheckCircle className="h-3 w-3 text-green-500" />
          ) : (
            <XCircle className="h-3 w-3 text-muted-foreground/50" />
          )}
          <span className="text-sm font-medium">{editor.name}</span>
          {editor.installed ? (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">
              {editor.version ? `v${editor.version}` : "Installed"}
            </span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Not installed
            </span>
          )}
          {isDefault && editor.installed && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              Default
            </span>
          )}
        </div>
        {editor.path && (
          <span className="text-xs text-muted-foreground truncate max-w-[300px]">
            {editor.path}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {editor.installed && !isDefault && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={onSetDefault}
          >
            Set as Default
          </Button>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function AgentsEditorTab() {
  const [config, setConfig] = useAtom(editorConfigAtom)
  const [localArgs, setLocalArgs] = useState(config.customArgs)

  // Detect editors
  const {
    data: editors,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.editor.detectEditors.useQuery()

  // Refresh editor detection
  const refreshMutation = trpc.editor.refreshEditors.useMutation({
    onSuccess: () => {
      refetch()
      toast.success("Editor detection refreshed")
    },
  })

  // Set default editor
  const handleSetDefault = useCallback(
    (editorId: string) => {
      setConfig((prev) => ({
        ...prev,
        defaultEditor: editorId as EditorId,
      }))
      toast.success("Default editor updated")
    },
    [setConfig]
  )

  // Save custom arguments
  const handleSaveArgs = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      customArgs: localArgs,
    }))
    toast.success("Custom arguments saved")
  }, [localArgs, setConfig])

  // Get installed editors for dropdown
  const installedEditors = editors?.filter((e) => e.installed) ?? []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col space-y-1.5">
        <div className="flex items-center gap-2">
          <GenericEditorIcon className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            External Editor
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Configure your preferred code editor for opening files and projects
        </p>
      </div>

      {/* Editor Sections */}
      <div className="space-y-3">
        {/* Default Editor Selection */}
        <RuntimeSection
          id="editor-selection"
          icon={<GenericEditorIcon className="h-5 w-5" />}
          title="Default Editor"
          description="Choose which editor to use when opening files"
          defaultOpen={true}
        >
          <div className="space-y-4">
            {/* Quick Select Dropdown */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Default Editor</Label>
              <Select
                value={config.defaultEditor ?? "auto"}
                onValueChange={(value) => {
                  setConfig((prev) => ({
                    ...prev,
                    defaultEditor: value === "auto" ? null : (value as EditorId),
                  }))
                }}
              >
                <SelectTrigger className="w-[250px]">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {installedEditors.map((editor) => (
                    <SelectItem key={editor.id} value={editor.id}>
                      {editor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Auto-detect will use the first available editor
              </p>
            </div>

            {/* Custom Arguments */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Custom Arguments</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={localArgs}
                  onChange={(e) => setLocalArgs(e.target.value)}
                  placeholder="e.g., --new-window --disable-extensions"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveArgs}
                  disabled={localArgs === config.customArgs}
                >
                  <Check className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Additional command-line arguments passed when opening files
              </p>
            </div>
          </div>
        </RuntimeSection>

        {/* Detected Editors List */}
        <RuntimeSection
          id="detected-editors"
          icon={<GenericEditorIcon className="h-5 w-5" />}
          title="Detected Editors"
          description="Editors found on your system"
          defaultOpen={true}
        >
          <div className="space-y-4">
            {/* Refresh button */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Click an editor to set it as default
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => refreshMutation.mutate()}
                disabled={isLoading || isRefetching || refreshMutation.isPending}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    isRefetching || refreshMutation.isPending ? "animate-spin" : ""
                  }`}
                />
                <span className="text-xs">Refresh</span>
              </Button>
            </div>

            {/* Editor list */}
            <div className="bg-background rounded-lg border border-border">
              <div className="p-3">
                {isLoading ? (
                  <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Detecting editors...</span>
                  </div>
                ) : editors && editors.length > 0 ? (
                  editors.map((editor) => (
                    <EditorRow
                      key={editor.id}
                      editor={editor}
                      isDefault={config.defaultEditor === editor.id}
                      onSetDefault={() => handleSetDefault(editor.id)}
                    />
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    No editors detected
                  </div>
                )}
              </div>
            </div>
          </div>
        </RuntimeSection>
      </div>
    </div>
  )
}
