import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { UsageDetailsDialog } from "./usage-details-dialog"
import {
  agentsSettingsDialogOpenAtom,
  anthropicOnboardingCompletedAtom,
  autoOfflineModeAtom,
  billingMethodAtom,
  openaiApiKeyAtom,
  showOfflineModeFeaturesAtom,
  // Unified model config
  activeProviderIdAtom,
  activeModelIdAtom,
  enabledProviderIdsAtom,
  toggleProviderEnabledAtom,
  updateProviderModelsAtom,
  enabledModelsPerProviderAtom,
  toggleModelEnabledAtom,
  providerModelsAtom,
  autoPopulateRecommendedModelsAtom,
  autoSelectTaskModelsAtom,
  imageProviderIdAtom,
  imageModelIdAtom,
  summaryProviderIdAtom,
  summaryModelIdAtom,
  agentModeProviderIdAtom,
  agentModeModelIdAtom,
  planModeProviderIdAtom,
  planModeModelIdAtom,
  researchModeProviderIdAtom,
  researchModeModelIdAtom,
} from "../../../lib/atoms"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/tooltip"
import { cn } from "../../../lib/utils"

// ============ Provider Icon ============

const PROVIDER_COLORS = [
  "bg-rose-500/20 text-rose-500",
  "bg-sky-500/20 text-sky-500",
  "bg-violet-500/20 text-violet-500",
  "bg-amber-500/20 text-amber-500",
  "bg-emerald-500/20 text-emerald-500",
  "bg-pink-500/20 text-pink-500",
  "bg-cyan-500/20 text-cyan-500",
  "bg-indigo-500/20 text-indigo-500",
]

function getStableColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  return PROVIDER_COLORS[Math.abs(hash) % PROVIDER_COLORS.length]!
}

function ProviderIcon({ type, id, name, size = 20 }: { type: ProviderType; id: string; name: string; size?: number }) {
  const s = `${size}px`

  if (type === "anthropic") {
    return (
      <div
        className="rounded-md flex items-center justify-center shrink-0 bg-[#D4A27F]/20"
        style={{ width: s, height: s }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          fillRule="evenodd"
          className="text-[#D4A27F]"
          style={{ width: `${size * 0.65}px`, height: `${size * 0.65}px` }}
        >
          <path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z" />
        </svg>
      </div>
    )
  }

  if (type === "litellm") {
    return (
      <div
        className="rounded-md flex items-center justify-center shrink-0 bg-blue-500/20"
        style={{ width: s, height: s }}
      >
        <span style={{ fontSize: `${size * 0.65}px`, lineHeight: 1 }}>🚅</span>
      </div>
    )
  }

  // Custom: first letter + stable color
  const colorClass = getStableColor(id)
  return (
    <div
      className={cn("rounded-md flex items-center justify-center shrink-0 font-bold", colorClass)}
      style={{ width: s, height: s, fontSize: `${size * 0.45}px` }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

// ============ Types ============

type ProviderType = "anthropic" | "litellm" | "custom"

interface ProviderInfo {
  id: string
  type: ProviderType
  name: string
  isEnabled: boolean
  isConfigured: boolean
}

interface ModelInfo {
  id: string
  name: string
}

// ============ Add Provider Dialog ============

function AddProviderDialog({
  open,
  onOpenChange,
  editProvider,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editProvider?: { id: string; name: string; baseUrl?: string; manualModels?: string[] } | null
}) {
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [manualModelsText, setManualModelsText] = useState("")
  const [isValidating, setIsValidating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const trpcUtils = trpc.useUtils()
  const addMutation = trpc.providers.addCustom.useMutation()
  const updateMutation = trpc.providers.updateCustom.useMutation()
  const testMutation = trpc.providers.testConnection.useMutation()

  const isEditing = !!editProvider

  // Log for debugging
  useEffect(() => {
    if (open && editProvider) {
      console.log("[AddProviderDialog] editProvider:", editProvider)
    }
  }, [open, editProvider])

  useEffect(() => {
    if (open && editProvider) {
      setName(editProvider.name)
      setBaseUrl(editProvider.baseUrl || "")
      setApiKey("")
      // Parse manual models - handle both array and string formats
      const models = editProvider.manualModels
      if (Array.isArray(models)) {
        setManualModelsText(models.join("\n"))
      } else {
        setManualModelsText("")
      }
      setValidationError(null)
    } else if (open) {
      setName("")
      setBaseUrl("")
      setApiKey("")
      setManualModelsText("")
      setValidationError(null)
    }
  }, [open, editProvider])

  // Parse manual models from textarea (one per line)
  const parseManualModels = (): string[] => {
    return manualModelsText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  const handleTest = async () => {
    if (!baseUrl || !apiKey) return

    setIsValidating(true)
    setValidationError(null)

    try {
      const result = await testMutation.mutateAsync({ baseUrl, apiKey })
      if (result.success) {
        toast.success(`连接成功，发现 ${result.modelCount} 个模型`)
      } else {
        // If /models fails but we have manual models, that's OK
        const manualModels = parseManualModels()
        if (manualModels.length > 0) {
          toast.success("API 连接正常（将使用手动配置的模型列表）")
        } else {
          setValidationError(result.error || "连接失败")
        }
      }
    } catch {
      setValidationError("连接测试失败")
    } finally {
      setIsValidating(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      toast.error("请填写名称和 Base URL")
      return
    }

    const manualModels = parseManualModels()

    setIsValidating(true)

    try {
      if (isEditing && editProvider) {
        await updateMutation.mutateAsync({
          id: editProvider.id,
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          ...(apiKey && { apiKey }),
          manualModels: manualModels.length > 0 ? manualModels : null,
        })
        toast.success("Provider 更新成功")
      } else {
        if (!apiKey.trim()) {
          toast.error("请填写 API Key")
          setIsValidating(false)
          return
        }

        const result = await addMutation.mutateAsync({
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          skipValidation: manualModels.length > 0, // Skip if manual models provided
          manualModels: manualModels.length > 0 ? manualModels : undefined,
        })

        if (!result.success) {
          setValidationError(result.error || "添加失败")
          setIsValidating(false)
          return
        }

        toast.success("Provider 添加成功")
      }

      await trpcUtils.providers.list.invalidate()
      // Also invalidate getModels cache for this provider so Configure Models shows updated list
      if (isEditing && editProvider) {
        await trpcUtils.providers.getModels.invalidate({ providerId: editProvider.id })
      }
      onOpenChange(false)
    } catch {
      toast.error(isEditing ? "更新失败" : "添加失败")
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "编辑 Provider" : "添加 Provider"}
          </DialogTitle>
          <DialogDescription>
            配置 Anthropic 兼容的 API 端点
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My API Provider"
              className="mt-1"
            />
          </div>

          <div>
            <Label>Base URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="mt-1"
            />
          </div>

          <div>
            <Label>API Key {isEditing && "(留空保持不变)"}</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEditing ? "••••••••" : "sk-..."}
              className="mt-1"
            />
          </div>

          <div>
            <Label className="flex items-center gap-1.5">
              手动模型列表
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>适用于不支持 /models 接口的 API。每行一个模型 ID，如 claude-3-5-sonnet-20241022</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-xs text-muted-foreground font-normal">(可选)</span>
            </Label>
            <textarea
              value={manualModelsText}
              onChange={(e) => setManualModelsText(e.target.value)}
              placeholder={"每行输入一个模型 ID，例如：\nclaude-3-5-sonnet-20241022\nclaude-3-opus-20240229"}
              className="mt-1 w-full h-24 px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 font-mono"
            />
            {manualModelsText && (
              <p className="mt-1 text-xs text-muted-foreground">
                已配置 {parseManualModels().length} 个模型
              </p>
            )}
          </div>

          {validationError && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {validationError}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={isValidating || !baseUrl || !apiKey}>
            {isValidating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            检 测
          </Button>
          <Button onClick={handleSave} disabled={isValidating}>
            {isValidating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {isEditing ? "保存" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ OAuth Section ============

function OAuthSection() {
  const { t } = useTranslation("settings")
  const { data: activeAccount, isLoading } = trpc.anthropicAccounts.getActive.useQuery()
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)

  const handleConnect = () => {
    setSettingsOpen(false)
    setBillingMethod("claude-subscription")
    setAnthropicOnboardingCompleted(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">{t("models.auth.oauth.checking")}</span>
      </div>
    )
  }

  if (activeAccount) {
    return (
      <div className="flex items-center gap-3 mt-1">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600">
          Connected
        </span>
        <button
          onClick={handleConnect}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("models.auth.oauth.reconnect")}
        </button>
      </div>
    )
  }

  return (
    <Button size="sm" onClick={handleConnect} className="mt-1">
      {t("models.auth.oauth.connect")}
    </Button>
  )
}

// ============ Configure Models Dialog ============

function ConfigureModelsDialog({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: ProviderInfo
}) {
  const updateProviderModels = useSetAtom(updateProviderModelsAtom)
  const toggleModel = useSetAtom(toggleModelEnabledAtom)
  const enabledModelsPerProvider = useAtomValue(enabledModelsPerProviderAtom)
  const autoPopulate = useSetAtom(autoPopulateRecommendedModelsAtom)
  const autoSelectTasks = useSetAtom(autoSelectTaskModelsAtom)
  const [modelSearch, setModelSearch] = useState("")

  const {
    data: modelsData,
    isLoading: modelsLoading,
    refetch: refetchModels,
  } = trpc.providers.getModels.useQuery(
    { providerId: provider.id, forceRefresh: false },
    { enabled: open && !!provider.id },
  )

  // Fetch recommended models for auto-population
  const { data: recommendedData } = trpc.providers.getRecommendedModels.useQuery(
    { providerId: provider.id },
    { enabled: open && !!provider.id },
  )

  useEffect(() => {
    if (modelsData?.models) {
      updateProviderModels({ providerId: provider.id, models: modelsData.models })
    }
  }, [modelsData?.models, provider.id, updateProviderModels])

  // Auto-populate recommended models on first open (when no models configured yet)
  useEffect(() => {
    if (recommendedData?.recommendedChatIds && recommendedData.recommendedChatIds.length > 0) {
      autoPopulate({ providerId: provider.id, recommendedIds: recommendedData.recommendedChatIds })
      autoSelectTasks({
        providerId: provider.id,
        imageModelId: recommendedData.imageModelId,
        summaryModelId: recommendedData.summaryModelId,
      })
    }
  }, [recommendedData, provider.id, autoPopulate, autoSelectTasks])

  const models = modelsData?.models || []
  const enabledModelIds = enabledModelsPerProvider[provider.id] || []

  const searchLower = modelSearch.toLowerCase()
  const filteredModels = modelSearch
    ? models.filter((m) =>
        m.id.toLowerCase().includes(searchLower) || m.name.toLowerCase().includes(searchLower),
      )
    : models

  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {}
    filteredModels.forEach((m) => {
      let groupName = "General"
      if (m.id.includes("/")) {
        groupName = m.id.split("/")[0]
      } else {
        const match = m.id.match(/^([a-zA-Z0-9]+)[-:]/)
        if (match) {
          groupName = match[1]
        } else if (m.id.includes("-")) {
          groupName = m.id.split("-")[0]
        }
      }
      groupName = groupName.charAt(0).toUpperCase() + groupName.slice(1)
      if (!groups[groupName]) groups[groupName] = []
      groups[groupName].push(m)
    })
    return groups
  }, [filteredModels])

  const sortedGroupKeys = useMemo(() => Object.keys(groupedModels).sort(), [groupedModels])

  const handleToggleModel = (modelId: string) => {
    toggleModel({ providerId: provider.id, modelId })
  }

  const enabledCount = enabledModelIds.length === 0 ? models.length : enabledModelIds.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderIcon type={provider.type} id={provider.id} name={provider.name} size={22} />
            Configure {provider.name} Models
          </DialogTitle>
          <DialogDescription>
            选择要在聊天中使用的模型 ({enabledCount} / {models.length} 已启用)
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-3">
          {/* Search */}
          {models.length > 10 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="搜索模型..."
                className="h-8 text-xs pl-8"
              />
            </div>
          )}

          {/* Model List */}
          <div className="flex-1 overflow-y-auto border rounded-md">
            {modelsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载模型列表...
              </div>
            ) : modelsData?.error ? (
              <div className="p-3 m-2 space-y-2">
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{modelsData.error}</div>
                <p className="text-xs text-muted-foreground">
                  如果此 API 不支持 /models 接口，可以点击 Provider 旁的编辑按钮手动配置模型列表。
                </p>
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                暂无可用模型
                <p className="text-xs mt-1">点击刷新按钮重新获取，或编辑 Provider 手动配置模型列表</p>
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground font-medium bg-muted sticky top-0 z-10 border-b border-border">
                  <tr>
                    <th className="px-3 py-2 font-medium">模型名称</th>
                    <th className="px-3 py-2 font-medium text-right">启用</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGroupKeys.map((group) => (
                    <React.Fragment key={group}>
                      {sortedGroupKeys.length > 1 && (
                        <tr className="bg-muted sticky top-8 z-10 border-b border-border">
                          <td colSpan={2} className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            {group}
                          </td>
                        </tr>
                      )}
                      {groupedModels[group]?.map((model) => {
                        const isEnabled = enabledModelIds.length === 0 || enabledModelIds.includes(model.id)
                        return (
                          <tr key={model.id} className="group hover:bg-muted/50 transition-colors">
                            <td className="px-3 py-2.5">
                              <span className="font-medium text-foreground text-xs">{model.name}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <Switch
                                checked={isEnabled}
                                onCheckedChange={() => handleToggleModel(model.id)}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <DialogFooter>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchModels()}
              disabled={modelsLoading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", modelsLoading && "animate-spin")} />
              刷新
            </Button>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ Provider Card ============

function ProviderCard({
  provider,
  isEnabled,
  onToggleEnabled,
  onConfigureModels,
  onEdit,
}: {
  provider: ProviderInfo
  isEnabled: boolean
  onToggleEnabled: () => void
  onConfigureModels: () => void
  onEdit?: () => void
}) {
  const { t } = useTranslation("settings")
  // Anthropic: check connection status
  const { data: activeAccount } = trpc.anthropicAccounts.getActive.useQuery(undefined, {
    enabled: provider.type === "anthropic",
  })
  const isAnthropicConnected = provider.type === "anthropic" ? !!activeAccount : true
  const canToggle = provider.type === "anthropic" ? isAnthropicConnected : true

  // Fetch model count for badge
  const { data: modelsData, isLoading: isModelsLoading } = trpc.providers.getModels.useQuery(
    { providerId: provider.id, forceRefresh: false },
    { enabled: isEnabled },
  )
  const updateProviderModels = useSetAtom(updateProviderModelsAtom)

  // Sync models to atom when fetched (to ensure they are available for dropdowns)
  useEffect(() => {
    if (modelsData?.models) {
      updateProviderModels({ providerId: provider.id, models: modelsData.models })
    }
  }, [modelsData?.models, provider.id, updateProviderModels])

  const enabledModelsPerProvider = useAtomValue(enabledModelsPerProviderAtom)
  const enabledModelIds = enabledModelsPerProvider[provider.id] || []
  const totalModels = modelsData?.models?.length || 0
  const enabledCount = enabledModelIds.length === 0 ? totalModels : enabledModelIds.length

  return (
    <div className={cn(
      "rounded-xl border transition-all",
      isEnabled ? "bg-background border-border" : "bg-muted/30 border-border opacity-80",
    )}>
      <div className="flex items-center justify-between p-4">
        {/* Left: Provider info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{provider.name}</span>
            {provider.type === "custom" && onEdit && (
              <button
                onClick={onEdit}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {provider.type === "anthropic" && t("models.auth.oauth.description")}
            {provider.type === "litellm" && t("models.auth.litellm.description")}
            {provider.type === "custom" && t("models.auth.custom.title")}
          </p>

          {/* Anthropic: OAuth status */}
          {provider.type === "anthropic" && <OAuthSection />}

          {/* Enabled model tags (when connected) */}
          {isEnabled && (
            isModelsLoading ? (
              <div className="mt-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            ) : enabledCount > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(modelsData?.models || [])
                  .filter((m) => enabledModelIds.length === 0 || enabledModelIds.includes(m.id))
                  .slice(0, 4)
                  .map((model) => (
                    <span
                      key={model.id}
                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border"
                    >
                      {model.name}
                    </span>
                  ))}
                {enabledCount > 4 && (
                  <span className="text-[10px] text-muted-foreground py-0.5">+{enabledCount - 4} more</span>
                )}
              </div>
            )
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {isEnabled && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={onConfigureModels}
            >
              Configure Models
            </Button>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={canToggle ? onToggleEnabled : undefined}
                    disabled={!canToggle}
                  />
                </div>
              </TooltipTrigger>
              {!canToggle && provider.type === "anthropic" && (
                <TooltipContent>请先关联 Anthropic 账户</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}

// ============ Task Model Dropdown ============

function TaskModelDropdown({
  providerIdAtom,
  modelIdAtom,
  label,
  description,
  showUseDefault,
}: {
  providerIdAtom: ReturnType<typeof import("jotai").atom<string | null>>
  modelIdAtom: ReturnType<typeof import("jotai").atom<string | null>>
  label: string
  description: string
  showUseDefault?: boolean
}) {
  const [selectedProviderId, setSelectedProviderId] = useAtom(providerIdAtom)
  const [selectedModelId, setSelectedModelId] = useAtom(modelIdAtom)

  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <TaskModelSelect
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        onSelect={(providerId, modelId) => {
          setSelectedProviderId(providerId)
          setSelectedModelId(modelId)
        }}
        showUseDefault={showUseDefault}
      />
    </div>
  )
}

// ============ Task Model Select (reusable dropdown) ============

function TaskModelSelect({
  selectedProviderId,
  selectedModelId,
  onSelect,
  showUseDefault = true,
}: {
  selectedProviderId: string | null
  selectedModelId: string | null
  onSelect: (providerId: string | null, modelId: string | null) => void
  showUseDefault?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [enabledProviderIds] = useAtom(enabledProviderIdsAtom)
  const enabledModelsPerProvider = useAtomValue(enabledModelsPerProviderAtom)
  const allModelsMap = useAtomValue(providerModelsAtom)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  const { data: allProviders } = trpc.providers.list.useQuery()
  const enabledProviders = (allProviders || []).filter((p) => enabledProviderIds.includes(p.id))

  // Build grouped models from Jotai cache (populated by ConfigureModelsDialog)
  const groupedModels = useMemo(() => {
    const groups: { provider: { id: string; name: string; type: string }; models: ModelInfo[] }[] = []
    for (const provider of enabledProviders) {
      const providerEnabledIds = enabledModelsPerProvider[provider.id] || []
      const providerModels = allModelsMap?.[provider.id] || []
      const filtered = providerEnabledIds.length === 0
        ? providerModels
        : providerModels.filter((m: ModelInfo) => providerEnabledIds.includes(m.id))
      if (filtered.length > 0) {
        groups.push({ provider, models: filtered })
      }
    }
    return groups
  }, [enabledProviders, enabledModelsPerProvider, allModelsMap])

  // Determine display
  const isUseDefault = !selectedProviderId && !selectedModelId
  let displayText = showUseDefault ? "Use Default Model" : "选择模型"
  let displayBadge: string | null = null

  if (selectedModelId) {
    // Find model name
    for (const group of groupedModels) {
      const found = group.models.find((m) => m.id === selectedModelId)
      if (found) {
        displayText = found.name
        displayBadge = group.provider.name
        break
      }
    }
    if (displayBadge === null) {
      displayText = selectedModelId
    }
  }

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="flex items-center gap-1.5 px-3 h-9 text-xs border rounded-md bg-muted/30 hover:bg-muted/50 transition-colors min-w-[200px] justify-between"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-1.5 truncate">
          <span className={cn("truncate", isUseDefault && !selectedModelId ? "text-muted-foreground" : "text-foreground")}>
            {displayText}
          </span>
          {displayBadge && (
            <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] bg-muted text-muted-foreground shrink-0">
              {displayBadge}
            </span>
          )}
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-[280px] bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="max-h-[300px] overflow-y-auto py-1">
            {/* Use Default option */}
            {showUseDefault && (
              <>
                <button
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between",
                    isUseDefault && "bg-primary/5",
                  )}
                  onClick={() => {
                    onSelect(null, null)
                    setIsOpen(false)
                  }}
                >
                  <span className="text-muted-foreground">Use Default Model</span>
                  {isUseDefault && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
                <div className="h-px bg-border mx-2 my-1" />
              </>
            )}

            {/* Grouped models */}
            {groupedModels.map((group) => (
              <div key={group.provider.id}>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {group.provider.name}
                </div>
                {group.models.map((model) => {
                  const isSelected = selectedModelId === model.id && selectedProviderId === group.provider.id
                  return (
                    <button
                      key={model.id}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between",
                        isSelected && "bg-primary/5",
                      )}
                      onClick={() => {
                        onSelect(group.provider.id, model.id)
                        setIsOpen(false)
                      }}
                    >
                      <span className={cn("truncate", isSelected && "font-medium")}>{model.name}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </button>
                  )
                })}
              </div>
            ))}

            {groupedModels.length === 0 && (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                暂无可用模型，请先启用 Provider 并配置模型
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============ Image Model Select ============

function ImageModelSelect({
  selectedProviderId,
  selectedModelId,
  onSelect,
  showUseDefault = true,
}: {
  selectedProviderId: string | null
  selectedModelId: string | null
  onSelect: (providerId: string | null, modelId: string | null) => void
  showUseDefault?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const allModelsMap = useAtomValue(providerModelsAtom)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  const { data: allProviders } = trpc.providers.list.useQuery()

  // Build grouped models - iterate all providers and find image models
  // Ignores "enabled models" checkbox configuration
  const groupedModels = useMemo(() => {
    const groups: { provider: { id: string; name: string; type: string }; models: ModelInfo[] }[] = []

    for (const provider of (allProviders || [])) {
      // Skip if provider has no models loaded yet
      const providerModels = allModelsMap?.[provider.id] || []
      if (providerModels.length === 0) continue

      // Filter for image models
      const imageModels = providerModels.filter((m) => isImageModel(m.id))

      if (imageModels.length > 0) {
        groups.push({ provider, models: imageModels })
      }
    }
    return groups
  }, [allProviders, allModelsMap])

  // Determine display
  const isUseDefault = !selectedProviderId && !selectedModelId
  let displayText = showUseDefault ? "Use Default Model" : "选择模型"
  let displayBadge: string | null = null

  if (selectedModelId) {
    // Find model name
    for (const group of groupedModels) {
      const found = group.models.find((m) => m.id === selectedModelId)
      if (found) {
        displayText = found.name
        displayBadge = group.provider.name
        break
      }
    }
    // Fallback if model not found in filtered list (e.g. manually set or not an image model anymore)
    if (displayBadge === null && selectedModelId) {
      displayText = selectedModelId
    }
  }

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="flex items-center gap-1.5 px-3 h-9 text-xs border rounded-md bg-muted/30 hover:bg-muted/50 transition-colors min-w-[200px] justify-between"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-1.5 truncate">
          <span className={cn("truncate", isUseDefault && !selectedModelId ? "text-muted-foreground" : "text-foreground")}>
            {displayText}
          </span>
          {displayBadge && (
            <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] bg-muted text-muted-foreground shrink-0">
              {displayBadge}
            </span>
          )}
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-[280px] bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="max-h-[300px] overflow-y-auto py-1">
            {/* Use Default option */}
            {showUseDefault && (
              <>
                <button
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between",
                    isUseDefault && "bg-primary/5",
                  )}
                  onClick={() => {
                    onSelect(null, null)
                    setIsOpen(false)
                  }}
                >
                  <span className="text-muted-foreground">Use Default Model</span>
                  {isUseDefault && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
                <div className="h-px bg-border mx-2 my-1" />
              </>
            )}

            {/* Grouped models */}
            {groupedModels.map((group) => (
              <div key={group.provider.id}>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {group.provider.name}
                </div>
                {group.models.map((model) => {
                  const isSelected = selectedModelId === model.id && selectedProviderId === group.provider.id
                  return (
                    <button
                      key={model.id}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between",
                        isSelected && "bg-primary/5",
                      )}
                      onClick={() => {
                        onSelect(group.provider.id, model.id)
                        setIsOpen(false)
                      }}
                    >
                      <span className={cn("truncate", isSelected && "font-medium")}>{model.name}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </button>
                  )
                })}
              </div>
            ))}

            {groupedModels.length === 0 && (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                没有找到图片生成模型
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============ Advanced Model Settings ============

function ImageModelDropdown({
  providerIdAtom,
  modelIdAtom,
  label,
  description,
  showUseDefault,
}: {
  providerIdAtom: ReturnType<typeof import("jotai").atom<string | null>>
  modelIdAtom: ReturnType<typeof import("jotai").atom<string | null>>
  label: string
  description: string
  showUseDefault?: boolean
}) {
  const [selectedProviderId, setSelectedProviderId] = useAtom(providerIdAtom)
  const [selectedModelId, setSelectedModelId] = useAtom(modelIdAtom)

  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <ImageModelSelect
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        onSelect={(providerId, modelId) => {
          setSelectedProviderId(providerId)
          setSelectedModelId(modelId)
        }}
        showUseDefault={showUseDefault}
      />
    </div>
  )
}

function AdvancedModelSettings() {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-border">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between p-4 rounded-xl bg-background hover:bg-muted/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="text-left">
          <h4 className="text-sm font-medium text-foreground">Advanced Model Settings</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Configure models for specific tasks</p>
        </div>
        {isExpanded
          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground" />
        }
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-border bg-background px-4 pb-4">
          {/* Default Model Row - using atoms directly */}
          <DefaultModelRow />

          {/* Agent Mode */}
          <TaskModelDropdown
            providerIdAtom={agentModeProviderIdAtom}
            modelIdAtom={agentModeModelIdAtom}
            label="Agent Mode"
            description="Model for autonomous task execution"
            showUseDefault
          />

          {/* Plan Mode */}
          <TaskModelDropdown
            providerIdAtom={planModeProviderIdAtom}
            modelIdAtom={planModeModelIdAtom}
            label="Plan Mode"
            description="Model for planning and architecture design"
            showUseDefault
          />

          {/* Image Generation */}
          <ImageModelDropdown
            providerIdAtom={imageProviderIdAtom}
            modelIdAtom={imageModelIdAtom}
            label="Image Generation"
            description="Model for generating images"
            showUseDefault
          />

          {/* Summary Model */}
          <TaskModelDropdown
            providerIdAtom={summaryProviderIdAtom}
            modelIdAtom={summaryModelIdAtom}
            label="Summary Model"
            description="Fast model for summaries, chat titles, and memory processing"
            showUseDefault
          />
        </div>
      )}
    </div>
  )
}

// Default Model Row - uses activeProvider/activeModel atoms directly
function DefaultModelRow() {
  const [activeProviderId, setActiveProviderId] = useAtom(activeProviderIdAtom)
  const [activeModelId, setActiveModelId] = useAtom(activeModelIdAtom)

  return (
    <div className="flex items-center justify-between py-3 border-b border-border">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">Default Model</span>
        <span className="text-xs text-muted-foreground">Primary model for general tasks</span>
      </div>
      <TaskModelSelect
        selectedProviderId={activeProviderId}
        selectedModelId={activeModelId}
        onSelect={(providerId, modelId) => {
          setActiveProviderId(providerId || "litellm")
          setActiveModelId(modelId)
        }}
        showUseDefault={false}
      />
    </div>
  )
}

// ============ Model Sources Panel ============

function ModelSourcesPanel() {
  const [enabledProviderIds] = useAtom(enabledProviderIdsAtom)
  const toggleProviderEnabled = useSetAtom(toggleProviderEnabledAtom)
  const [activeProviderId, setActiveProviderId] = useAtom(activeProviderIdAtom)

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editProvider, setEditProvider] = useState<{
    id: string
    name: string
    baseUrl?: string
    manualModels?: string[]
  } | null>(null)
  const [configureProvider, setConfigureProvider] = useState<ProviderInfo | null>(null)

  const trpcUtils = trpc.useUtils()
  const { data: providers, isLoading } = trpc.providers.list.useQuery()
  const removeMutation = trpc.providers.removeCustom.useMutation()

  const isProviderEnabled = (id: string) => enabledProviderIds.includes(id)

  const handleDeleteProvider = async (id: string) => {
    if (!confirm("确定要删除这个 Provider 吗？")) return
    try {
      await removeMutation.mutateAsync({ id })
      await trpcUtils.providers.list.invalidate()
      if (activeProviderId === id) {
        setActiveProviderId(null)
      }
      toast.success("Provider 已删除")
    } catch {
      toast.error("删除失败")
    }
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        (providers || []).map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            isEnabled={isProviderEnabled(provider.id)}
            onToggleEnabled={() => toggleProviderEnabled(provider.id)}
            onConfigureModels={() => setConfigureProvider(provider)}
            onEdit={provider.type === "custom" ? async () => {
              try {
                const detail = await trpcUtils.providers.get.fetch({ id: provider.id })
                console.log("[ModelSourcesPanel.onEdit] Provider detail:", detail)
                setEditProvider({
                  id: provider.id,
                  name: provider.name,
                  baseUrl: detail?.baseUrl,
                  manualModels: detail?.manualModels,
                })
              } catch (e) {
                console.error("[ModelSourcesPanel.onEdit] Failed to fetch provider:", e)
                setEditProvider({
                  id: provider.id,
                  name: provider.name,
                })
              }
            } : undefined}
          />
        ))
      )}

      {/* Add Custom Model Button */}
      <button
        className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-dashed border-border hover:bg-muted/30 transition-colors"
        onClick={() => setAddDialogOpen(true)}
      >
        <Plus className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Add Custom Model</span>
      </button>

      {/* Add/Edit Provider Dialog */}
      <AddProviderDialog
        open={addDialogOpen || !!editProvider}
        onOpenChange={(open) => {
          if (!open) {
            setAddDialogOpen(false)
            setEditProvider(null)
          }
        }}
        editProvider={editProvider}
      />

      {/* Configure Models Dialog */}
      {configureProvider && (
        <ConfigureModelsDialog
          open={!!configureProvider}
          onOpenChange={(open) => {
            if (!open) setConfigureProvider(null)
          }}
          provider={configureProvider}
        />
      )}
    </div>
  )
}

// ============ Helper functions ============

function isImageModel(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return (
    lower.includes("image") ||
    lower.includes("dall-e") ||
    lower.includes("midjourney") ||
    lower.includes("flux") ||
    lower.includes("stable-diffusion") ||
    lower.includes("sdxl")
  )
}

function formatTokenCount(tokens: number): string {
  if (!tokens) return "0"
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}

function formatCost(cost: number): string {
  if (!cost) return "$0.00"
  return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`
}

function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrow(window.innerWidth <= 768)
    }

    checkWidth()
    window.addEventListener("resize", checkWidth)
    return () => window.removeEventListener("resize", checkWidth)
  }, [])

  return isNarrow
}

// ============ Contribution Heatmap ============

function ContributionHeatmap() {
  const { t } = useTranslation("settings")
  const { data: activity } = trpc.usage.getDailyActivity.useQuery()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [numWeeks, setNumWeeks] = useState(20)
  const [pageOffset, setPageOffset] = useState(0)
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null)

  useEffect(() => {
    const calculateWeeks = () => {
      if (!containerRef.current) return
      const containerWidth = containerRef.current.offsetWidth
      const cellSize = 10
      const gap = 2
      const weekWidth = cellSize + gap
      const availableWidth = containerWidth - 8
      const weeks = Math.floor(availableWidth / weekWidth)
      setNumWeeks(Math.max(weeks, 4))
    }

    calculateWeeks()
    window.addEventListener("resize", calculateWeeks)
    return () => window.removeEventListener("resize", calculateWeeks)
  }, [])

  useEffect(() => {
    if (slideDirection) {
      const timer = setTimeout(() => setSlideDirection(null), 300)
      return () => clearTimeout(timer)
    }
  }, [slideDirection])

  const activityMap = new Map<string, { count: number; totalTokens: number; totalCostUsd: number }>()
  activity?.forEach((d) => {
    activityMap.set(d.date, { count: d.count, totalTokens: d.totalTokens, totalCostUsd: d.totalCostUsd || 0 })
  })

  const today = new Date()
  const days: { date: string; count: number; totalTokens: number; totalCostUsd: number }[] = []

  const endDate = new Date(today)
  endDate.setDate(endDate.getDate() - pageOffset * numWeeks * 7)

  const daysToGoBack = (numWeeks - 1) * 7 + endDate.getDay()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - daysToGoBack)

  for (let i = 0; i <= daysToGoBack + (6 - endDate.getDay()); i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    if (d > endDate || d > today) break

    const dateStr = d.toISOString().split("T")[0]!
    const data = activityMap.get(dateStr)
    days.push({
      date: dateStr,
      count: data?.count || 0,
      totalTokens: data?.totalTokens || 0,
      totalCostUsd: data?.totalCostUsd || 0,
    })
  }

  const MAX_COST_THRESHOLD = 200
  const EASTER_EGG_THRESHOLD = 1000

  const getLevel = (cost: number): number => {
    if (cost === 0) return 0
    if (cost >= EASTER_EGG_THRESHOLD) return 5
    const ratio = cost / MAX_COST_THRESHOLD
    if (ratio <= 0.25) return 1
    if (ratio <= 0.5) return 2
    if (ratio <= 0.75) return 3
    return 4
  }

  const levelColors = [
    "bg-primary/10",
    "bg-primary/30",
    "bg-primary/50",
    "bg-primary/70",
    "bg-primary",
  ]

  const easterEggEmojis = ["🔥", "💸", "🤯", "💰", "🚀", "⚡", "🌟", "💎"]
  const getEasterEggEmoji = (date: string): string => {
    const hash = date.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return easterEggEmojis[hash % easterEggEmojis.length]!
  }

  const weeks: typeof days[] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const monthLabels: { label: string; weekIndex: number }[] = []
  let lastMonth = -1
  weeks.forEach((week, weekIndex) => {
    const firstDay = week[0]
    if (firstDay) {
      const month = new Date(firstDay.date).getMonth()
      if (month !== lastMonth) {
        const lastLabel = monthLabels[monthLabels.length - 1]
        if (!lastLabel || weekIndex - lastLabel.weekIndex >= 3) {
          monthLabels.push({ label: months[month]!, weekIndex })
        }
        lastMonth = month
      }
    }
  })

  const totalContributions = days.reduce((sum, d) => sum + d.count, 0)

  const maxPages = Math.floor(52 / Math.max(numWeeks, 1))
  const canGoBack = pageOffset < maxPages
  const canGoForward = pageOffset > 0

  const goBack = () => {
    if (canGoBack) {
      setSlideDirection("right")
      setPageOffset((p) => p + 1)
    }
  }

  const goForward = () => {
    if (canGoForward) {
      setSlideDirection("left")
      setPageOffset((p) => p - 1)
    }
  }

  const getSlideClass = () => {
    if (!slideDirection) return ""
    return slideDirection === "left" ? "animate-slide-in-left" : "animate-slide-in-right"
  }

  return (
    <div ref={containerRef} className="space-y-1">
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(-30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-left { animation: slideInLeft 0.25s ease-out; }
        .animate-slide-in-right { animation: slideInRight 0.25s ease-out; }
      `}
      </style>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{totalContributions.toLocaleString()} {t("models.usage.contributions")}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={goBack}
            disabled={!canGoBack}
            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[140px] text-center text-[10px]">
            {days[0]?.date} ~ {days[days.length - 1]?.date}
          </span>
          <button
            onClick={goForward}
            disabled={!canGoForward}
            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden">
        <div className={`flex text-[10px] text-muted-foreground mb-1 h-3 ${getSlideClass()}`}>
          {monthLabels.map((m, i) => (
            <div key={i} className="absolute" style={{ left: `${m.weekIndex * 12}px` }}>
              {m.label}
            </div>
          ))}
        </div>

        <TooltipProvider delayDuration={100}>
          <div className={`flex gap-[2px] ${getSlideClass()}`} key={pageOffset}>
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-[2px]">
                {[0, 1, 2, 3, 4, 5, 6].map((dayIndex) => {
                  const day = week[dayIndex]
                  if (!day) return <div key={dayIndex} className="w-[10px] h-[10px]" />

                  const level = getLevel(day.totalCostUsd)
                  const isEasterEgg = level === 5
                  const hasActivity = level > 0

                  if (!hasActivity) {
                    return (
                      <div
                        key={dayIndex}
                        className="w-[10px] h-[10px] rounded-[2px] bg-primary/5 cursor-default"
                      />
                    )
                  }

                  const tooltipContent = (
                    <div className="space-y-0.5">
                      <div className="font-medium">{day.date}</div>
                      <div>{day.count} {t("models.usage.requests")}</div>
                      <div>{formatTokenCount(day.totalTokens)} {t("models.usage.tokens")}</div>
                      <div>{formatCost(day.totalCostUsd)}{isEasterEgg ? " 🎉" : ""}</div>
                    </div>
                  )

                  if (isEasterEgg) {
                    return (
                      <Tooltip key={dayIndex}>
                        <TooltipTrigger asChild>
                          <div className="w-[10px] h-[10px] rounded-[2px] flex items-center justify-center cursor-default transition-transform hover:scale-150">
                            <span className="text-[8px] leading-none">{getEasterEggEmoji(day.date)}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="pointer-events-none">
                          {tooltipContent}
                        </TooltipContent>
                      </Tooltip>
                    )
                  }

                  return (
                    <Tooltip key={dayIndex}>
                      <TooltipTrigger asChild>
                        <div
                          className={`w-[10px] h-[10px] rounded-[2px] ${levelColors[level]} cursor-default transition-colors hover:ring-1 hover:ring-foreground/30`}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="pointer-events-none">
                        {tooltipContent}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </div>
        </TooltipProvider>

        <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-muted-foreground">
          <span>Less</span>
          {levelColors.map((color, i) => (
            <div key={i} className={`w-[10px] h-[10px] rounded-[2px] ${color}`} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  )
}

// ============ Usage Statistics Section ============

function UsageStatisticsSection({ onViewDetails }: { onViewDetails: () => void }) {
  const { t } = useTranslation("settings")
  const { data: summary, isLoading } = trpc.usage.getSummary.useQuery()

  if (isLoading) {
    return (
      <div className="bg-background rounded-lg border border-border p-4 text-center text-sm text-muted-foreground">
        {t("models.usage.loading")}
      </div>
    )
  }

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="p-4 space-y-4">
        <ContributionHeatmap />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">{t("models.usage.today")}</div>
            <div className="text-lg font-semibold">
              {formatTokenCount(summary?.today?.totalTokens || 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCost(summary?.today?.totalCostUsd || 0)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">{t("models.usage.week")}</div>
            <div className="text-lg font-semibold">
              {formatTokenCount(summary?.week?.totalTokens || 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCost(summary?.week?.totalCostUsd || 0)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">{t("models.usage.month")}</div>
            <div className="text-lg font-semibold">
              {formatTokenCount(summary?.month?.totalTokens || 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCost(summary?.month?.totalCostUsd || 0)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">{t("models.usage.allTime")}</div>
            <div className="text-lg font-semibold">
              {formatTokenCount(summary?.total?.totalTokens || 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCost(summary?.total?.totalCostUsd || 0)}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-muted p-3 rounded-b-lg flex justify-end border-t">
        <Button size="sm" variant="outline" onClick={onViewDetails}>
          <BarChart3 className="h-3 w-3 mr-1" />
          {t("models.usage.viewDetails")}
        </Button>
      </div>
    </div>
  )
}

// ============ Main Component ============

export function AgentsModelsTab() {
  const { t } = useTranslation("settings")
  const [autoOffline, setAutoOffline] = useAtom(autoOfflineModeAtom)
  const [usageDetailsOpen, setUsageDetailsOpen] = useState(false)
  const isNarrowScreen = useIsNarrowScreen()

  const { data: ollamaStatus } = trpc.ollama.getStatus.useQuery(undefined, {
    refetchInterval: 30000,
  })

  const showOfflineFeatures = useAtomValue(showOfflineModeFeaturesAtom)

  // OpenAI API key state
  const [storedOpenAIKey, setStoredOpenAIKey] = useAtom(openaiApiKeyAtom)
  const [openaiKey, setOpenaiKey] = useState(storedOpenAIKey)
  const setOpenAIKeyMutation = trpc.voice.setOpenAIKey.useMutation()
  const trpcUtils = trpc.useUtils()

  useEffect(() => {
    setOpenaiKey(storedOpenAIKey)
  }, [storedOpenAIKey])

  const trimmedOpenAIKey = openaiKey.trim()
  const canResetOpenAI = !!trimmedOpenAIKey

  const handleSaveOpenAI = async () => {
    if (trimmedOpenAIKey === storedOpenAIKey) return
    if (trimmedOpenAIKey && !trimmedOpenAIKey.startsWith("sk-")) {
      toast.error("Invalid OpenAI API key format. Key should start with 'sk-'")
      return
    }

    try {
      await setOpenAIKeyMutation.mutateAsync({ key: trimmedOpenAIKey })
      setStoredOpenAIKey(trimmedOpenAIKey)
      await trpcUtils.voice.isAvailable.invalidate()
      toast.success("OpenAI API key saved")
    } catch {
      toast.error("Failed to save OpenAI API key")
    }
  }

  const handleResetOpenAI = async () => {
    try {
      await setOpenAIKeyMutation.mutateAsync({ key: "" })
      setStoredOpenAIKey("")
      setOpenaiKey("")
      await trpcUtils.voice.isAvailable.invalidate()
      toast.success("OpenAI API key removed")
    } catch {
      toast.error("Failed to remove OpenAI API key")
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      {!isNarrowScreen && (
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">{t("models.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("models.description")}</p>
        </div>
      )}

      {/* Offline Mode Section */}
      {showOfflineFeatures && (
        <div className="space-y-2">
          <div className="pb-2">
            <h4 className="text-sm font-medium text-foreground">{t("models.offline.title")}</h4>
          </div>

          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {t("models.offline.ollamaStatus.title")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {ollamaStatus?.ollama.available
                      ? `${t("models.offline.ollamaStatus.running")} - ${t("models.offline.ollamaStatus.modelsInstalled", { count: ollamaStatus.ollama.models.length })}`
                      : t("models.offline.ollamaStatus.notRunning")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {ollamaStatus?.ollama.available ? (
                    <span className="text-green-600 text-sm font-medium">
                      ● {t("models.offline.ollamaStatus.available")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      ○ {t("models.offline.ollamaStatus.unavailable")}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {t("models.offline.autoOffline.title")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t("models.offline.autoOffline.description")}
                  </p>
                </div>
                <Switch checked={autoOffline} onCheckedChange={setAutoOffline} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Model Sources Section */}
      <div className="space-y-2">
        <div className="pb-1">
          <h4 className="text-sm font-medium text-foreground">模型来源</h4>
          <p className="text-xs text-muted-foreground">管理 API 提供商，选择聊天和 Agent 使用的模型</p>
        </div>
        <ModelSourcesPanel />
      </div>

      {/* Advanced Model Settings */}
      <div className="space-y-2">
        <AdvancedModelSettings />
      </div>

      {/* Usage Statistics Section */}
      <div className="space-y-2">
        <div className="pb-2">
          <h4 className="text-sm font-medium text-foreground">{t("models.usage.title")}</h4>
          <p className="text-xs text-muted-foreground">{t("models.usage.description")}</p>
        </div>

        <UsageStatisticsSection onViewDetails={() => setUsageDetailsOpen(true)} />
      </div>

      {/* OpenAI API Key for Voice Input */}
      <div className="space-y-2">
        <div className="pb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground">{t("models.voice.title")}</h4>
          {canResetOpenAI && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetOpenAI}
              disabled={setOpenAIKeyMutation.isPending}
              className="text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
            >
              {t("models.voice.openaiKey.remove")}
            </Button>
          )}
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between gap-6 p-4">
            <div className="flex-1">
              <Label className="text-sm font-medium">{t("models.voice.openaiKey.title")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("models.voice.openaiKey.description")}
              </p>
            </div>
            <div className="shrink-0 w-80">
              <Input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                onBlur={handleSaveOpenAI}
                className="w-full"
                placeholder="sk-..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* Usage Details Dialog */}
      <UsageDetailsDialog open={usageDetailsOpen} onOpenChange={setUsageDetailsOpen} />
    </div>
  )
}
