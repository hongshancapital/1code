import { useAtom, useAtomValue } from "jotai"
import {
  RefreshCw,
  FolderOpen,
  Check,
  X,
  Terminal,
  Hexagon,
  Download,
  Wrench,
  ExternalLink,
  Loader2,
  Copy,
  CheckCircle,
  XCircle,
} from "lucide-react"
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

// Tool info type from backend
interface ToolInfoDisplay {
  name: string
  displayName: string
  category: string
  installed: boolean
  version: string | null
  path: string | null
  installCommand: string | null
  description: string
  required: boolean
}
import {
  packageManagerAtom,
  runtimePathsAtom,
  defaultDebugPortAtom,
  preferredRuntimeAtom,
  type PackageManager,
  type RuntimePaths,
  type PreferredRuntime,
} from "../../../lib/atoms/runner"
import { RuntimeSection, RuntimeSubSection } from "./runtime-section"

// ============================================================================
// Runtime Row Component
// ============================================================================

interface RuntimeRowProps {
  label: string
  detected: { version: string; path: string } | null
  customPath: string | null
  onPathChange: (path: string) => void
  isValidating?: boolean
}

function RuntimeRow({
  label,
  detected,
  customPath,
  onPathChange,
  isValidating,
}: RuntimeRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [localPath, setLocalPath] = useState(customPath || "")

  const displayPath = customPath || detected?.path || "Not found"
  const displayVersion = detected?.version || "-"
  const isInstalled = detected !== null || customPath !== null

  const handleSave = useCallback(() => {
    onPathChange(localPath.trim())
    setIsEditing(false)
  }, [localPath, onPathChange])

  const handleCancel = useCallback(() => {
    setLocalPath(customPath || "")
    setIsEditing(false)
  }, [customPath])

  const handleClear = useCallback(() => {
    onPathChange("")
    setLocalPath("")
    setIsEditing(false)
  }, [onPathChange])

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {isInstalled ? (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">
              v{displayVersion}
            </span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Not installed
            </span>
          )}
        </div>
        {!isEditing && (
          <span className="text-xs text-muted-foreground truncate max-w-[280px]">
            {displayPath}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {isEditing ? (
          <>
            <Input
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder={detected?.path || "/path/to/runtime"}
              className="w-[200px] h-7 text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave()
                if (e.key === "Escape") handleCancel()
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={handleSave}
              disabled={isValidating}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={handleCancel}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            {customPath && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={handleClear}
              >
                Reset
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setIsEditing(true)}
              title="Set custom path"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Common Tools Section Component
// ============================================================================

interface ToolRowProps {
  name: string
  installed: boolean
  version: string | null
  path: string | null
  installCommand: string | null
  description: string
  isInstalling: boolean
  onInstall: () => void
}

function ToolRow({
  name,
  installed,
  version,
  path,
  installCommand,
  description,
  isInstalling,
  onInstall,
}: ToolRowProps) {
  const [copied, setCopied] = useState(false)

  const handleCopyCommand = useCallback(() => {
    if (installCommand) {
      navigator.clipboard.writeText(installCommand)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success("Command copied to clipboard")
    }
  }, [installCommand])

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {installed ? (
            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{name}</span>
          {installed && version && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">
              v{version}
            </span>
          )}
          {!installed && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Not installed
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{description}</span>
        {installed && path && (
          <span className="text-[10px] text-muted-foreground/60 truncate max-w-[280px]">
            {path}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {!installed && installCommand && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-xs"
              onClick={handleCopyCommand}
              title="Copy install command"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={onInstall}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Install
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// Get platform display name
function getPlatformDisplayName(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "macOS"
    case "win32":
      return "Windows"
    case "linux":
      return "Linux"
    default:
      return platform
  }
}

function CommonToolsSection() {
  const [installingTool, setInstallingTool] = useState<string | null>(null)

  // Real tool detection from backend
  const {
    data: toolsData,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.runner.detectTools.useQuery()

  // Install tool mutation
  const installMutation = trpc.runner.installTool.useMutation({
    onSuccess: (result, { toolName }) => {
      if (result.success) {
        toast.success(`${toolName} installed successfully`)
        refetch()
      } else {
        toast.error(`Failed to install ${toolName}: ${result.error}`)
      }
    },
    onError: (error, { toolName }) => {
      toast.error(`Failed to install ${toolName}: ${error.message}`)
    },
    onSettled: () => {
      setInstallingTool(null)
    },
  })

  const handleInstall = useCallback(
    (toolName: string, command: string) => {
      setInstallingTool(toolName)
      installMutation.mutate({ toolName, command })
    },
    [installMutation]
  )

  // Filter to show common category tools, sorted by priority
  const priorityTools = ["git", "rg", "fd", "jq", "curl", "brew"]
  const commonTools = toolsData?.tools
    ?.filter((t) => t.category === "common")
    .slice()
    .sort((a, b) => {
      const aIdx = priorityTools.indexOf(a.name)
      const bIdx = priorityTools.indexOf(b.name)
      if (aIdx !== -1 && bIdx === -1) return -1
      if (aIdx === -1 && bIdx !== -1) return 1
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
      return a.name.localeCompare(b.name)
    })

  const platformName = toolsData?.platform
    ? getPlatformDisplayName(toolsData.platform)
    : ""

  return (
    <RuntimeSection
      id="common-tools"
      icon={<Wrench className="h-5 w-5" />}
      title="Common Tools"
      description={`CLI tools that enhance Hóng functionality${platformName ? ` (${platformName})` : ""}`}
      defaultOpen={true}
    >
      <div className="flex flex-col gap-4">
        {/* Header with refresh */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            These tools improve search, file operations, and developer experience
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
            />
            <span className="text-xs">Refresh</span>
          </Button>
        </div>

        {/* Tools list */}
        <div className="bg-background rounded-lg border border-border">
          <div className="p-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Detecting tools...</span>
              </div>
            ) : commonTools && commonTools.length > 0 ? (
              commonTools.map((tool) => (
                <ToolRow
                  key={tool.name}
                  name={tool.displayName}
                  installed={tool.installed}
                  version={tool.version}
                  path={tool.path}
                  installCommand={tool.installCommand}
                  description={tool.description}
                  isInstalling={installingTool === tool.name}
                  onInstall={() =>
                    tool.installCommand &&
                    handleInstall(tool.name, tool.installCommand)
                  }
                />
              ))
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">
                No tools detected
              </div>
            )}
          </div>
        </div>

        {/* Note about package managers */}
        <p className="text-[10px] text-muted-foreground">
          Note: Installation requires Homebrew on macOS, apt on Linux, or winget/Scoop on Windows.
          You can also copy the command and run it in your terminal.
        </p>
      </div>
    </RuntimeSection>
  )
}

// ============================================================================
// Python Section Component
// ============================================================================

function PythonSection() {
  const [installingTool, setInstallingTool] = useState<string | null>(null)

  // Get Python tools from the same query
  const {
    data: toolsData,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.runner.detectTools.useQuery()

  // Install tool mutation
  const installMutation = trpc.runner.installTool.useMutation({
    onSuccess: (result, { toolName }) => {
      if (result.success) {
        toast.success(`${toolName} installed successfully`)
        refetch()
      } else {
        toast.error(`Failed to install ${toolName}: ${result.error}`)
      }
    },
    onError: (error, { toolName }) => {
      toast.error(`Failed to install ${toolName}: ${error.message}`)
    },
    onSettled: () => {
      setInstallingTool(null)
    },
  })

  const handleInstall = useCallback(
    (toolName: string, command: string) => {
      setInstallingTool(toolName)
      installMutation.mutate({ toolName, command })
    },
    [installMutation]
  )

  // Filter to show python category tools
  const pythonTools = toolsData?.tools?.filter((t) => t.category === "python")

  return (
    <RuntimeSection
      id="python"
      icon={
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M9.585 11.692h4.328s2.432.039 2.432-2.35V5.391S16.714 3 11.936 3C7.362 3 7.647 4.983 7.647 4.983l.006 2.055h4.363v.617H5.92s-2.927-.332-2.927 4.282 2.555 4.45 2.555 4.45h1.524v-2.141s-.083-2.554 2.513-2.554zm-.056-5.74a.784.784 0 110-1.57.784.784 0 110 1.57z" />
          <path d="M18.452 7.532h-1.524v2.141s.083 2.554-2.513 2.554h-4.328s-2.432-.04-2.432 2.35v3.951s-.369 2.391 4.409 2.391c4.573 0 4.288-1.983 4.288-1.983l-.006-2.054h-4.363v-.617h6.097s2.927.332 2.927-4.282-2.555-4.451-2.555-4.451zm-4.025 10.48a.784.784 0 110 1.57.784.784 0 110-1.57z" />
        </svg>
      }
      title="Python"
      description="Python interpreter and package managers"
      defaultOpen={false}
    >
      <div className="space-y-4">
        {/* Header with refresh */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Python runtime and package management tools
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
            />
            <span className="text-xs">Refresh</span>
          </Button>
        </div>

        {/* Tools list */}
        <div className="bg-background rounded-lg border border-border">
          <div className="p-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Detecting Python tools...</span>
              </div>
            ) : pythonTools && pythonTools.length > 0 ? (
              pythonTools.map((tool) => (
                <ToolRow
                  key={tool.name}
                  name={tool.displayName}
                  installed={tool.installed}
                  version={tool.version}
                  path={tool.path}
                  installCommand={tool.installCommand}
                  description={tool.description}
                  isInstalling={installingTool === tool.name}
                  onInstall={() =>
                    tool.installCommand &&
                    handleInstall(tool.name, tool.installCommand)
                  }
                />
              ))
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">
                No Python tools detected
              </div>
            )}
          </div>
        </div>
      </div>
    </RuntimeSection>
  )
}

// ============================================================================
// Node.js Icon Component
// ============================================================================

function NodeJsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 1.85c-.27 0-.55.07-.78.2l-7.44 4.3c-.48.28-.78.8-.78 1.36v8.58c0 .56.3 1.08.78 1.36l1.95 1.12c.95.46 1.27.47 1.71.47 1.4 0 2.21-.85 2.21-2.33V8.44c0-.12-.1-.22-.22-.22H8.5c-.13 0-.23.1-.23.22v8.47c0 .66-.68 1.31-1.77.76L4.45 16.5a.26.26 0 01-.12-.22V7.72c0-.09.05-.17.12-.22l7.44-4.29a.26.26 0 01.26 0l7.44 4.29c.07.04.12.13.12.22v8.58c0 .09-.05.17-.12.22l-7.44 4.29c-.04.02-.1.04-.15.04s-.1-.02-.15-.04l-1.93-1.14c-.08-.05-.19-.05-.27-.02-.67.3-.8.33-1.42.5-.15.04-.37.11.08.32l2.51 1.48c.23.14.5.21.78.21s.55-.07.78-.21l7.44-4.29c.48-.28.78-.8.78-1.36V7.72c0-.56-.3-1.08-.78-1.36l-7.44-4.3c-.23-.14-.5-.21-.78-.21z" />
    </svg>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function AgentsRuntimeTab() {
  const [packageManager, setPackageManager] = useAtom(packageManagerAtom)
  const [runtimePaths, setRuntimePaths] = useAtom(runtimePathsAtom)
  const [debugPort, setDebugPort] = useAtom(defaultDebugPortAtom)
  const [preferredRuntime, setPreferredRuntime] = useAtom(preferredRuntimeAtom)
  const [validatingType, setValidatingType] = useState<keyof RuntimePaths | null>(null)

  // Detect runtimes query
  const {
    data: detectedRuntimes,
    refetch,
    isLoading,
    isRefetching,
  } = trpc.runner.detectRuntimes.useQuery()

  // Validate path mutation
  const validateMutation = trpc.runner.validateRuntimePath.useMutation()

  // Handle custom path change with validation
  const handlePathChange = useCallback(
    async (type: keyof RuntimePaths, path: string) => {
      if (!path.trim()) {
        // Clear custom path
        setRuntimePaths((prev) => ({ ...prev, [type]: null }))
        return
      }

      setValidatingType(type)
      try {
        const result = await validateMutation.mutateAsync({ path, type })
        if (result.valid) {
          setRuntimePaths((prev) => ({ ...prev, [type]: path }))
          toast.success(`${type} path updated to v${result.version}`)
        } else {
          toast.error(result.error || "Invalid runtime path")
        }
      } catch (error) {
        toast.error("Failed to validate path")
      } finally {
        setValidatingType(null)
      }
    },
    [setRuntimePaths, validateMutation]
  )

  // Handle debug port change with validation
  const handleDebugPortChange = useCallback(
    (value: string) => {
      const port = parseInt(value, 10)
      if (isNaN(port)) return
      if (port < 1024 || port > 65535) {
        toast.error("Port must be between 1024 and 65535")
        return
      }
      setDebugPort(port)
    },
    [setDebugPort]
  )

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            Runtime Settings
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Configure runtime environments for running and debugging scripts
        </p>
      </div>

      {/* Runtime Sections */}
      <div className="flex flex-col gap-3">
        {/* Common Tools Section - First */}
        <CommonToolsSection />

        {/* Node.js / JavaScript Section */}
        <RuntimeSection
          id="nodejs"
          icon={<NodeJsIcon className="h-5 w-5" />}
          title="Node.js / JavaScript"
          description="Node.js, Bun, and package managers"
          defaultOpen={false}
        >
          <div className="flex flex-col gap-6">
            {/* Preferred Runtime */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Preferred Runtime</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5"
                  onClick={() => refetch()}
                  disabled={isLoading || isRefetching}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
                  />
                  <span className="text-xs">Refresh</span>
                </Button>
              </div>
              <Select
                value={preferredRuntime}
                onValueChange={(value) => setPreferredRuntime(value as PreferredRuntime)}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="node">Node.js</SelectItem>
                  <SelectItem value="bun">Bun</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Auto-detect will choose based on project configuration
              </p>
            </div>

            {/* Node.js Sub-section */}
            <RuntimeSubSection title="Node.js">
              <div className="bg-background rounded-lg border border-border">
                <div className="p-3">
                  <RuntimeRow
                    label="Node runtime"
                    detected={detectedRuntimes?.node || null}
                    customPath={runtimePaths.node}
                    onPathChange={(path) => handlePathChange("node", path)}
                    isValidating={validatingType === "node"}
                  />
                </div>
              </div>
            </RuntimeSubSection>

            {/* Bun Sub-section */}
            <RuntimeSubSection title="Bun">
              <div className="bg-background rounded-lg border border-border">
                <div className="p-3">
                  <RuntimeRow
                    label="Bun runtime"
                    detected={detectedRuntimes?.bun || null}
                    customPath={runtimePaths.bun}
                    onPathChange={(path) => handlePathChange("bun", path)}
                    isValidating={validatingType === "bun"}
                  />
                </div>
              </div>
            </RuntimeSubSection>

            {/* Package Managers Sub-section */}
            <RuntimeSubSection title="Package Manager">
              <div className="bg-background rounded-lg border border-border">
                <div className="p-3">
                  <RuntimeRow
                    label="npm"
                    detected={detectedRuntimes?.npm || null}
                    customPath={runtimePaths.npm}
                    onPathChange={(path) => handlePathChange("npm", path)}
                    isValidating={validatingType === "npm"}
                  />
                  <RuntimeRow
                    label="yarn"
                    detected={detectedRuntimes?.yarn || null}
                    customPath={runtimePaths.yarn}
                    onPathChange={(path) => handlePathChange("yarn", path)}
                    isValidating={validatingType === "yarn"}
                  />
                  <RuntimeRow
                    label="pnpm"
                    detected={detectedRuntimes?.pnpm || null}
                    customPath={runtimePaths.pnpm}
                    onPathChange={(path) => handlePathChange("pnpm", path)}
                    isValidating={validatingType === "pnpm"}
                  />
                </div>
              </div>

              {/* Default Package Manager */}
              <div className="mt-3 flex flex-col gap-2">
                <Label className="text-sm font-medium">Default Package Manager</Label>
                <Select
                  value={packageManager}
                  onValueChange={(value) => setPackageManager(value as PackageManager)}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="bun">bun</SelectItem>
                    <SelectItem value="npm">npm</SelectItem>
                    <SelectItem value="yarn">yarn</SelectItem>
                    <SelectItem value="pnpm">pnpm</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Auto-detect will choose based on the project's lock file
                </p>
              </div>
            </RuntimeSubSection>

            {/* Debug Settings Sub-section */}
            <RuntimeSubSection title="Debug Settings">
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Default Debug Port</Label>
                <Input
                  type="number"
                  value={debugPort}
                  onChange={(e) => handleDebugPortChange(e.target.value)}
                  className="w-[120px]"
                  min={1024}
                  max={65535}
                />
                <p className="text-xs text-muted-foreground">
                  Port used for Node.js inspector when running in debug mode (default: 9229)
                </p>
              </div>
            </RuntimeSubSection>
          </div>
        </RuntimeSection>

        {/* Python Section */}
        <PythonSection />

        {/* Go Section - Coming Soon */}
        <RuntimeSection
          id="go"
          icon={
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M1.811 10.231c-.047 0-.058-.023-.035-.059l.246-.315c.023-.035.081-.058.128-.058h4.172c.046 0 .058.035.035.07l-.199.303c-.023.036-.082.07-.117.07zM.047 11.306c-.047 0-.059-.023-.035-.058l.245-.316c.023-.035.082-.058.129-.058h5.328c.047 0 .07.035.058.07l-.093.28c-.012.047-.058.07-.105.07zm2.828 1.075c-.047 0-.059-.035-.035-.07l.163-.292c.023-.035.07-.07.117-.07h2.337c.047 0 .07.035.07.082l-.023.28c0 .047-.047.082-.082.082zm12.129-2.36c-.736.187-1.239.327-1.963.514-.176.046-.187.058-.339-.117-.176-.199-.304-.327-.548-.444-.737-.362-1.45-.257-2.115.175-.795.514-1.204 1.274-1.192 2.22.011.935.654 1.706 1.577 1.835.795.105 1.46-.175 1.987-.77.105-.13.199-.27.328-.456H10.18c-.245 0-.304-.152-.222-.35.152-.362.432-.97.596-1.274a.315.315 0 01.292-.187h4.253c-.023.316-.023.631-.07.947a4.983 4.983 0 01-.958 2.29c-.841 1.11-1.94 1.8-3.33 1.986-1.145.152-2.209-.07-3.143-.77-.865-.655-1.356-1.52-1.484-2.595-.152-1.274.222-2.419.993-3.424.83-1.086 1.928-1.776 3.272-2.02 1.098-.2 2.15-.07 3.096.571.62.41 1.063.947 1.356 1.602.058.082.023.117-.07.14z" />
            </svg>
          }
          title="Go"
          description="Go compiler and tools"
          disabled={true}
        >
          <div className="text-sm text-muted-foreground">
            Go runtime configuration coming soon.
          </div>
        </RuntimeSection>

        {/* Rust Section - Coming Soon */}
        <RuntimeSection
          id="rust"
          icon={
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M23.687 11.709l-.995-.616a13.559 13.559 0 00-.028-.29l.855-.79a.249.249 0 00-.106-.42l-1.103-.303a10.245 10.245 0 00-.084-.283l.68-.943a.249.249 0 00-.168-.393l-1.137-.124a12.15 12.15 0 00-.136-.27l.476-1.072a.249.249 0 00-.226-.351l-1.143.06a7.847 7.847 0 00-.183-.248l.254-1.168a.249.249 0 00-.278-.294l-1.118.238a9.778 9.778 0 00-.224-.219l.02-1.22a.249.249 0 00-.32-.229l-1.063.41a8.94 8.94 0 00-.26-.183l-.216-1.168a.249.249 0 00-.356-.153l-.98.567a9.582 9.582 0 00-.291-.14l-.443-1.085a.249.249 0 00-.381-.094l-.869.708a8.869 8.869 0 00-.313-.09l-.654-.97a.249.249 0 00-.395-.027l-.731.831a9.95 9.95 0 00-.326-.034l-.848-.826a.249.249 0 00-.396.044l-.571.932a9.27 9.27 0 00-.33.024l-1.017-.658a.249.249 0 00-.385.121l-.394 1.005a9.402 9.402 0 00-.325.08l-1.156-.469a.249.249 0 00-.361.19l-.199 1.048a8.746 8.746 0 00-.311.132l-1.262-.264a.249.249 0 00-.325.247l.004 1.058a8.17 8.17 0 00-.29.18l-1.332-.048a.249.249 0 00-.28.297l.202 1.036a8.464 8.464 0 00-.26.222l-1.362.174a.249.249 0 00-.225.335l.394.983a9.162 9.162 0 00-.222.259l-1.351.394a.249.249 0 00-.164.36l.575.899a10.963 10.963 0 00-.175.29l-1.298.605a.249.249 0 00-.096.374l.74.782a9.026 9.026 0 00-.122.313l-1.203.8a.249.249 0 00-.026.38l.885.639a9.812 9.812 0 00-.063.325l-1.071.976a.249.249 0 00.045.375l1.004.47a8.284 8.284 0 000 .327l-1.003.469a.249.249 0 00-.046.376l1.072.976c.017.11.038.218.062.325l-.885.639a.249.249 0 00.025.38l1.203.8c.037.105.078.21.122.313l-.74.783a.249.249 0 00.097.373l1.297.605c.055.097.113.194.175.29l-.575.898a.249.249 0 00.164.361l1.351.395c.072.087.146.173.222.258l-.394.983a.249.249 0 00.225.336l1.363.173c.084.075.17.15.259.222l-.201 1.036a.249.249 0 00.279.297l1.332-.048c.095.062.191.122.29.18l-.004 1.058a.249.249 0 00.325.247l1.262-.264c.102.046.206.09.31.132l.2 1.048a.249.249 0 00.36.19l1.156-.47c.107.029.215.055.325.08l.394 1.006a.249.249 0 00.385.12l1.017-.657c.109.01.219.018.33.024l.57.932a.249.249 0 00.397.044l.848-.826c.108 0 .217-.02.326-.034l.731.831a.249.249 0 00.395-.027l.655-.97c.104-.027.209-.057.313-.09l.868.708a.249.249 0 00.382-.094l.442-1.085c.097-.045.194-.091.291-.14l.98.567a.249.249 0 00.356-.153l.216-1.168c.088-.058.174-.12.26-.183l1.063.41a.249.249 0 00.319-.228l-.02-1.221c.076-.071.151-.145.224-.219l1.118.238a.249.249 0 00.278-.294l-.254-1.167c.063-.081.124-.164.183-.248l1.144.06a.249.249 0 00.226-.352l-.476-1.072c.048-.088.093-.179.136-.27l1.138-.123a.249.249 0 00.168-.393l-.68-.943c.03-.094.058-.188.084-.283l1.103-.303a.249.249 0 00.106-.42l-.855-.79c.013-.096.022-.193.028-.29l.995-.616a.249.249 0 000-.424z" />
            </svg>
          }
          title="Rust"
          description="Rust compiler and Cargo"
          disabled={true}
        >
          <div className="text-sm text-muted-foreground">
            Rust runtime configuration coming soon.
          </div>
        </RuntimeSection>
      </div>
    </div>
  )
}
