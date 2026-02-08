import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  User,
} from "lucide-react"
import React, { useEffect, useState } from "react"
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
  enabledProviderIdsAtom,
  toggleProviderEnabledAtom,
  updateProviderModelsAtom,
  enabledModelsPerProviderAtom,
  toggleModelEnabledAtom,
  imageProviderIdAtom,
  imageModelIdAtom,
  summaryProviderIdAtom,
  summaryModelIdAtom,
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
  editProvider?: { id: string; name: string; baseUrl?: string } | null
}) {
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [isValidating, setIsValidating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const trpcUtils = trpc.useUtils()
  const addMutation = trpc.providers.addCustom.useMutation()
  const updateMutation = trpc.providers.updateCustom.useMutation()
  const testMutation = trpc.providers.testConnection.useMutation()

  const isEditing = !!editProvider

  useEffect(() => {
    if (open && editProvider) {
      setName(editProvider.name)
      setBaseUrl(editProvider.baseUrl || "")
      setApiKey("")
      setValidationError(null)
    } else if (open) {
      setName("")
      setBaseUrl("")
      setApiKey("")
      setValidationError(null)
    }
  }, [open, editProvider])

  const handleTest = async () => {
    if (!baseUrl || !apiKey) return

    setIsValidating(true)
    setValidationError(null)

    try {
      const result = await testMutation.mutateAsync({ baseUrl, apiKey })
      if (result.success) {
        toast.success(`连接成功，发现 ${result.modelCount} 个模型`)
      } else {
        setValidationError(result.error || "连接失败")
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

    setIsValidating(true)

    try {
      if (isEditing && editProvider) {
        await updateMutation.mutateAsync({
          id: editProvider.id,
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          ...(apiKey && { apiKey }),
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
          skipValidation: false,
        })

        if (!result.success) {
          setValidationError(result.error || "添加失败")
          setIsValidating(false)
          return
        }

        toast.success("Provider 添加成功")
      }

      await trpcUtils.providers.list.invalidate()
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

// ============ Provider Detail Panel (right side) ============

function ProviderDetailPanel({
  provider,
  isActive,
  onToggleActive,
  enabledModelIds,
  onToggleModel,
  onEdit,
  onDelete,
}: {
  provider: ProviderInfo
  isActive: boolean
  onToggleActive: () => void
  enabledModelIds: string[]
  onToggleModel: (modelId: string) => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const updateProviderModels = useSetAtom(updateProviderModelsAtom)
  const [modelSearch, setModelSearch] = useState("")

  // Anthropic: check if OAuth is connected
  const { data: activeAccount } = trpc.anthropicAccounts.getActive.useQuery(undefined, {
    enabled: provider.type === "anthropic",
  })
  const isAnthropicConnected = !!activeAccount

  // Fetch models
  const {
    data: modelsData,
    isLoading: modelsLoading,
    refetch: refetchModels,
  } = trpc.providers.getModels.useQuery(
    { providerId: provider.id, forceRefresh: false },
    { enabled: !!provider.id },
  )

  // Update cache when models are loaded
  useEffect(() => {
    if (modelsData?.models) {
      updateProviderModels({ providerId: provider.id, models: modelsData.models })
    }
  }, [modelsData?.models, provider.id, updateProviderModels])

  const models = modelsData?.models || []

  // Search filter
  const searchLower = modelSearch.toLowerCase()
  const filteredModels = modelSearch
    ? models.filter((m) =>
        m.id.toLowerCase().includes(searchLower) || m.name.toLowerCase().includes(searchLower),
      )
    : models

  // Can this provider be toggled active?
  const canToggle = provider.type === "anthropic" ? isAnthropicConnected : true

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
      {/* Provider header with enable toggle + actions */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <ProviderIcon type={provider.type} id={provider.id} name={provider.name} size={22} />
          <span className="text-sm font-semibold">{provider.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {provider.type === "custom" && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Switch
                    checked={isActive}
                    onCheckedChange={canToggle ? onToggleActive : undefined}
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

      <div className="flex-1 overflow-y-auto">
        {/* Anthropic OAuth section */}
        {provider.type === "anthropic" && (
          <div className="p-4 space-y-4">
            <OAuthSection />
          </div>
        )}

        {/* LiteLLM: show description only, no settings */}
        {provider.type === "litellm" && (
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Hóng 为您提供的内置 LLM 节点
            </p>
          </div>
        )}

        {/* Models section */}
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">模型</span>
              <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                {models.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {models.length > 10 && (
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="筛选..."
                    className="h-7 text-xs pl-7 w-36"
                  />
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => refetchModels()}
                disabled={modelsLoading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", modelsLoading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载模型列表...
            </div>
          ) : modelsData?.error ? (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{modelsData.error}</div>
          ) : filteredModels.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">暂无可用模型</div>
          ) : (
            <div className="space-y-0.5">
              {filteredModels.map((model) => {
                const isEnabled = enabledModelIds.length === 0 || enabledModelIds.includes(model.id)
                return (
                  <div
                    key={model.id}
                    className={cn(
                      "flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors",
                      isEnabled ? "bg-primary/10" : "hover:bg-muted/50",
                    )}
                    onClick={() => onToggleModel(model.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        "w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors",
                        isEnabled ? "bg-primary border-primary" : "border-muted-foreground/30",
                      )}>
                        {isEnabled && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <span className={cn("text-sm truncate", isEnabled && "font-medium")}>
                        {model.name}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
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
      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium">
              {activeAccount.displayName || activeAccount.email || t("models.auth.oauth.title")}
            </div>
            <div className="text-xs text-muted-foreground">{t("models.auth.oauth.connected")}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open("https://claude.ai/settings/usage", "_blank")}
            className="text-muted-foreground"
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            {t("models.usage.viewDetails")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleConnect}>
            {t("models.auth.oauth.reconnect")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Button onClick={handleConnect} className="w-full">
      {t("models.auth.oauth.connect")}
    </Button>
  )
}

// ============ Provider Management Panel (left + right) ============

function ProviderManagementPanel() {
  const [activeProviderId, setActiveProviderId] = useAtom(activeProviderIdAtom)
  const [enabledProviderIds] = useAtom(enabledProviderIdsAtom)
  const toggleProviderEnabled = useSetAtom(toggleProviderEnabledAtom)

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editProvider, setEditProvider] = useState<{
    id: string
    name: string
    baseUrl?: string
  } | null>(null)

  const trpcUtils = trpc.useUtils()
  const { data: providers, isLoading } = trpc.providers.list.useQuery()
  const removeMutation = trpc.providers.removeCustom.useMutation()

  // Auto-select first provider if none selected
  useEffect(() => {
    if (providers && providers.length > 0 && !selectedProviderId) {
      setSelectedProviderId(providers[0].id)
    }
  }, [providers, selectedProviderId])

  const selectedProvider = providers?.find((p) => p.id === selectedProviderId)

  // Check if a provider is enabled
  const isProviderEnabled = (id: string) => enabledProviderIds.includes(id)

  const toggleModel = useSetAtom(toggleModelEnabledAtom)
  const enabledModelsPerProvider = useAtomValue(enabledModelsPerProviderAtom)

  const handleToggleModel = (modelId: string) => {
    if (selectedProviderId) {
      toggleModel({ providerId: selectedProviderId, modelId })
    }
  }

  const handleDeleteProvider = async (id: string) => {
    if (!confirm("确定要删除这个 Provider 吗？")) return
    try {
      await removeMutation.mutateAsync({ id })
      await trpcUtils.providers.list.invalidate()
      if (selectedProviderId === id) {
        setSelectedProviderId(providers?.[0]?.id || null)
      }
      if (activeProviderId === id) {
        setActiveProviderId(null)
      }
      toast.success("Provider 已删除")
    } catch {
      toast.error("删除失败")
    }
  }

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="flex h-[420px]">
        {/* Left: Provider list */}
        <div className="w-44 border-r flex flex-col shrink-0">
          {/* Provider list */}
          <div className="flex-1 overflow-y-auto py-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (providers || []).length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                暂无 Provider
              </div>
            ) : (
              (providers || []).map((p) => {
                const enabled = isProviderEnabled(p.id)
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center justify-between px-3 py-2 cursor-pointer transition-colors group",
                      selectedProviderId === p.id
                        ? "bg-accent"
                        : "hover:bg-muted/50",
                    )}
                    onClick={() => setSelectedProviderId(p.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ProviderIcon type={p.type} id={p.id} name={p.name} />
                      <span className={cn("text-xs font-medium truncate", !enabled && "text-muted-foreground")}>{p.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Enabled indicator */}
                      {enabled && (
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Add button */}
          <div className="p-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center text-xs h-8"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              添加
            </Button>
          </div>
        </div>

        {/* Right: Provider detail */}
        {selectedProvider ? (
          <ProviderDetailPanel
            provider={selectedProvider}
            isActive={isProviderEnabled(selectedProvider.id)}
            onToggleActive={() => {
              toggleProviderEnabled(selectedProvider.id)
            }}
            enabledModelIds={enabledModelsPerProvider[selectedProvider.id] || []}
            onToggleModel={handleToggleModel}
            onEdit={selectedProvider.type === "custom" ? async () => {
              // Fetch detail to get baseUrl for edit dialog
              try {
                const detail = await trpcUtils.providers.get.fetch({ id: selectedProvider.id })
                setEditProvider({
                  id: selectedProvider.id,
                  name: selectedProvider.name,
                  baseUrl: detail?.baseUrl,
                })
              } catch {
                setEditProvider({
                  id: selectedProvider.id,
                  name: selectedProvider.name,
                })
              }
            } : undefined}
            onDelete={selectedProvider.type === "custom" ? () => handleDeleteProvider(selectedProvider.id) : undefined}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            选择一个 Provider 查看详情
          </div>
        )}
      </div>

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
    </div>
  )
}

// ============ Image Model Section ============

function ImageModelSection() {
  const [imageProviderId, setImageProviderId] = useAtom(imageProviderIdAtom)
  const [imageModelId, setImageModelId] = useAtom(imageModelIdAtom)
  const [enabledProviderIds] = useAtom(enabledProviderIdsAtom)
  const [modelListOpen, setModelListOpen] = useState(false)

  const { data: allProviders } = trpc.providers.list.useQuery()
  const providers = (allProviders || []).filter((p) => enabledProviderIds.includes(p.id))

  const { data: modelsData, isLoading: modelsLoading } = trpc.providers.getModels.useQuery(
    { providerId: imageProviderId! },
    { enabled: !!imageProviderId },
  )
  const models = modelsData?.models || []

  const selectedProvider = providers.find((p) => p.id === imageProviderId)
  const selectedModel = models.find((m) => m.id === imageModelId)

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="p-4 space-y-4">
        {/* Provider selector */}
        <div>
          <Label className="text-xs font-medium text-muted-foreground">Provider</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {providers.length === 0 ? (
              <p className="text-xs text-muted-foreground">请先在上方添加并激活 Provider</p>
            ) : (
              providers.map((p) => (
                <button
                  key={p.id}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors",
                    imageProviderId === p.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted/50 text-muted-foreground",
                  )}
                  onClick={() => {
                    if (imageProviderId === p.id) {
                      setImageProviderId(null)
                      setImageModelId(null)
                      setModelListOpen(false)
                    } else {
                      setImageProviderId(p.id)
                      setImageModelId(null)
                      setModelListOpen(false)
                    }
                  }}
                >
                  <ProviderIcon type={p.type} id={p.id} name={p.name} size={16} />
                  {p.name}
                  {imageProviderId === p.id && <Check className="h-3 w-3" />}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Model selector - collapsible */}
        {imageProviderId && (
          <div>
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-sm border rounded-md hover:bg-muted/50 transition-colors"
              onClick={() => setModelListOpen(!modelListOpen)}
            >
              <span className={selectedModel ? "text-foreground" : "text-muted-foreground"}>
                {modelsLoading ? "加载模型..." : selectedModel ? selectedModel.name : "选择模型"}
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", modelListOpen && "rotate-180")} />
            </button>

            {modelListOpen && !modelsLoading && models.length > 0 && (
              <div className="mt-1 border rounded-md max-h-[200px] overflow-y-auto">
                {models.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer transition-colors",
                      imageModelId === m.id ? "bg-primary/10" : "hover:bg-muted/50",
                    )}
                    onClick={() => {
                      setImageModelId(imageModelId === m.id ? null : m.id)
                      if (imageModelId !== m.id) setModelListOpen(false)
                    }}
                  >
                    <span className={cn("truncate", imageModelId === m.id && "font-medium")}>{m.name}</span>
                    {imageModelId === m.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ Summary Model Section ============

function SummaryModelSection() {
  const [summaryProviderId, setSummaryProviderId] = useAtom(summaryProviderIdAtom)
  const [summaryModelId, setSummaryModelId] = useAtom(summaryModelIdAtom)
  const [enabledProviderIds] = useAtom(enabledProviderIdsAtom)
  const [modelListOpen, setModelListOpen] = useState(false)

  const { data: allProviders } = trpc.providers.list.useQuery()
  const providers = (allProviders || []).filter((p) => enabledProviderIds.includes(p.id))

  const { data: modelsData, isLoading: modelsLoading } = trpc.providers.getModels.useQuery(
    { providerId: summaryProviderId! },
    { enabled: !!summaryProviderId },
  )
  const models = modelsData?.models || []

  const selectedProvider = providers.find((p) => p.id === summaryProviderId)
  const selectedModel = models.find((m) => m.id === summaryModelId)

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="p-4 space-y-4">
        {/* Provider selector */}
        <div>
          <Label className="text-xs font-medium text-muted-foreground">Provider</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            {providers.length === 0 ? (
              <p className="text-xs text-muted-foreground">请先在上方添加并激活 Provider</p>
            ) : (
              providers.map((p) => (
                <button
                  key={p.id}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors",
                    summaryProviderId === p.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted/50 text-muted-foreground",
                  )}
                  onClick={() => {
                    if (summaryProviderId === p.id) {
                      setSummaryProviderId(null)
                      setSummaryModelId(null)
                      setModelListOpen(false)
                    } else {
                      setSummaryProviderId(p.id)
                      setSummaryModelId(null)
                      setModelListOpen(false)
                    }
                  }}
                >
                  <ProviderIcon type={p.type} id={p.id} name={p.name} size={16} />
                  {p.name}
                  {summaryProviderId === p.id && <Check className="h-3 w-3" />}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Model selector - collapsible */}
        {summaryProviderId && (
          <div>
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-sm border rounded-md hover:bg-muted/50 transition-colors"
              onClick={() => setModelListOpen(!modelListOpen)}
            >
              <span className={selectedModel ? "text-foreground" : "text-muted-foreground"}>
                {modelsLoading ? "加载模型..." : selectedModel ? selectedModel.name : "选择模型"}
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", modelListOpen && "rotate-180")} />
            </button>

            {modelListOpen && !modelsLoading && models.length > 0 && (
              <div className="mt-1 border rounded-md max-h-[200px] overflow-y-auto">
                {models.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer transition-colors",
                      summaryModelId === m.id ? "bg-primary/10" : "hover:bg-muted/50",
                    )}
                    onClick={() => {
                      setSummaryModelId(summaryModelId === m.id ? null : m.id)
                      if (summaryModelId !== m.id) setModelListOpen(false)
                    }}
                  >
                    <span className={cn("truncate", summaryModelId === m.id && "font-medium")}>{m.name}</span>
                    {summaryModelId === m.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ Helper functions ============

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
    "bg-muted/30",
    "bg-emerald-900/50",
    "bg-emerald-700/70",
    "bg-emerald-500/80",
    "bg-emerald-400",
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
      `}</style>

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
                        className={`w-[10px] h-[10px] rounded-[2px] ${levelColors[0]} cursor-default`}
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

      {/* Provider Section */}
      <div className="space-y-2">
        <div className="pb-1">
          <h4 className="text-sm font-medium text-foreground">模型来源</h4>
          <p className="text-xs text-muted-foreground">管理 API 提供商，选择聊天和 Agent 使用的模型</p>
        </div>
        <ProviderManagementPanel />
      </div>

      {/* Image Model Section */}
      <div className="space-y-2">
        <div className="pb-1">
          <h4 className="text-sm font-medium text-foreground">生图模型</h4>
          <p className="text-xs text-muted-foreground">从已激活的 Provider 中选择一个生图模型</p>
        </div>
        <ImageModelSection />
      </div>

      {/* Summary Model Section */}
      <div className="space-y-2">
        <div className="pb-1">
          <h4 className="text-sm font-medium text-foreground">快捷摘要模型</h4>
          <p className="text-xs text-muted-foreground">用于生成对话名称和提交消息的轻量模型。未配置时使用默认服务。</p>
        </div>
        <SummaryModelSection />
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
