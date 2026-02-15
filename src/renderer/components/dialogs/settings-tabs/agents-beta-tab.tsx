import { useAtom } from "jotai"
import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  autoOfflineModeAtom,
  betaAutomationsEnabledAtom,
  betaBrowserEnabledAtom,
  betaMemoryEnabledAtom,
  betaRenameFolderEnabledAtom,
  betaVoiceInputEnabledAtom,
  enableTasksAtom,
  historyEnabledAtom,
  selectedOllamaModelAtom,
  showOfflineModeFeaturesAtom,
  skillAwarenessEnabledAtom,
} from "../../../lib/atoms"
import { isFeatureAvailable, IS_DEV } from "../../../lib/feature-flags"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { ExternalLinkIcon } from "../../../icons/icons"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select"
import { Switch } from "../../ui/switch"

// Hook to detect narrow screen
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

const MINIMUM_OLLAMA_VERSION = "0.14.2"
const RECOMMENDED_MODEL = "qwen3-coder:30b"

export function AgentsBetaTab() {
  const { t } = useTranslation('settings')
  const isNarrowScreen = useIsNarrowScreen()
  const [historyEnabled, setHistoryEnabled] = useAtom(historyEnabledAtom)
  const [showOfflineFeatures, setShowOfflineFeatures] = useAtom(showOfflineModeFeaturesAtom)
  const [autoOffline, setAutoOffline] = useAtom(autoOfflineModeAtom)
  const [selectedOllamaModel, setSelectedOllamaModel] = useAtom(selectedOllamaModelAtom)
  const [automationsEnabled, setAutomationsEnabled] = useAtom(betaAutomationsEnabledAtom)
  const [enableTasks, setEnableTasks] = useAtom(enableTasksAtom)
  const [skillAwarenessEnabled, setSkillAwarenessEnabled] = useAtom(skillAwarenessEnabledAtom)
  const [betaMemoryEnabled, setBetaMemoryEnabled] = useAtom(betaMemoryEnabledAtom)
  const [betaBrowserEnabled, setBetaBrowserEnabled] = useAtom(betaBrowserEnabledAtom)
  const [betaVoiceInputEnabled, setBetaVoiceInputEnabled] = useAtom(betaVoiceInputEnabledAtom)
  const [betaRenameFolderEnabled, setBetaRenameFolderEnabled] = useAtom(betaRenameFolderEnabledAtom)

  // dev-only features
  const canEnableAutomations = isFeatureAvailable("automations")
  const canEnableVoiceInput = isFeatureAvailable("voiceInput")
  const [copied, setCopied] = useState(false)

  // Get Ollama status
  const { data: ollamaStatus } = trpc.ollama.getStatus.useQuery(undefined, {
    refetchInterval: showOfflineFeatures ? 30000 : false, // Only poll when feature is enabled
    enabled: showOfflineFeatures,
  })

  const handleCopy = () => {
    navigator.clipboard.writeText(`ollama pull ${RECOMMENDED_MODEL}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header - hidden on narrow screens since it's in the navigation bar */}
      {!isNarrowScreen && (
        <div className="flex flex-col gap-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">{t('beta.title')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('beta.description')}
          </p>
        </div>
      )}

      {/* Beta Features Section */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        {/* Rollback Toggle */}
        <div className="flex items-center justify-between p-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t('beta.rollback.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('beta.rollback.description')}
            </span>
          </div>
          <Switch
            checked={historyEnabled}
            onCheckedChange={setHistoryEnabled}
          />
        </div>

        {/* Offline Mode Toggle */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t('beta.offlineMode.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('beta.offlineMode.description')}
            </span>
          </div>
          <Switch
            checked={showOfflineFeatures}
            onCheckedChange={setShowOfflineFeatures}
          />
        </div>

        {/* Automations & Inbox Toggle */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className={cn("text-sm font-medium", canEnableAutomations ? "text-foreground" : "text-muted-foreground")}>
              {t('beta.automations.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {canEnableAutomations
                ? t('beta.automations.description')
                : t('beta.automations.devOnly')}
            </span>
          </div>
          <Switch
            checked={automationsEnabled && canEnableAutomations}
            onCheckedChange={(checked) => {
              if (canEnableAutomations) {
                setAutomationsEnabled(checked)
              }
            }}
            disabled={!canEnableAutomations}
          />
        </div>

        {/* Agent Tasks Toggle */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t('beta.tasks.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('beta.tasks.description')}
            </span>
          </div>
          <Switch
            checked={enableTasks}
            onCheckedChange={setEnableTasks}
          />
        </div>

        {/* Skill Awareness Toggle */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t('beta.skillAwareness.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('beta.skillAwareness.description')}
            </span>
          </div>
          <Switch
            checked={skillAwarenessEnabled}
            onCheckedChange={setSkillAwarenessEnabled}
          />
        </div>

        {/* Memory & Search Toggle */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t('beta.memory.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('beta.memory.description')}
            </span>
          </div>
          <Switch
            checked={betaMemoryEnabled}
            onCheckedChange={setBetaMemoryEnabled}
          />
        </div>

        {/* Browser Toggle */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t('beta.browser.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('beta.browser.description')}
            </span>
          </div>
          <Switch
            checked={betaBrowserEnabled}
            onCheckedChange={setBetaBrowserEnabled}
          />
        </div>

        {/* Voice Input Toggle */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className={cn("text-sm font-medium", canEnableVoiceInput ? "text-foreground" : "text-muted-foreground")}>
              {t('beta.voiceInput.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {canEnableVoiceInput
                ? t('beta.voiceInput.description')
                : t('beta.voiceInput.devOnly')}
            </span>
          </div>
          <Switch
            checked={betaVoiceInputEnabled && canEnableVoiceInput}
            onCheckedChange={(checked) => {
              if (canEnableVoiceInput) {
                setBetaVoiceInputEnabled(checked)
              }
            }}
            disabled={!canEnableVoiceInput}
          />
        </div>

        {/* Rename Folder Toggle */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t('beta.renameFolder.title')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('beta.renameFolder.description')}
            </span>
          </div>
          <Switch
            checked={betaRenameFolderEnabled}
            onCheckedChange={setBetaRenameFolderEnabled}
          />
        </div>
      </div>

      {/* Offline Mode Settings - only show when feature is enabled */}
      {showOfflineFeatures && (
        <div className="flex flex-col gap-2">
          <div className="pb-2">
            <h4 className="text-sm font-medium text-foreground">{t('beta.offlineSettings.title')}</h4>
          </div>

          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="p-4 flex flex-col gap-4">
              {/* Status */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {t('beta.offlineSettings.ollamaStatus')}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {ollamaStatus?.ollama.available
                      ? `Running - ${ollamaStatus.ollama.models.length} model${ollamaStatus.ollama.models.length !== 1 ? 's' : ''} installed`
                      : 'Not running or not installed'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {ollamaStatus?.ollama.available ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="text-sm text-emerald-500">Available</span>
                    </>
                  ) : (
                    <>
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                      <span className="text-sm text-muted-foreground">Unavailable</span>
                    </>
                  )}
                </div>
              </div>

              {/* Model selector */}
              {ollamaStatus?.ollama.available && ollamaStatus.ollama.models.length > 0 && (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground">
                      {t('beta.offlineSettings.model')}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {t('beta.offlineSettings.modelHint')}
                    </p>
                  </div>
                  <Select
                    value={selectedOllamaModel || ollamaStatus.ollama.recommendedModel || ollamaStatus.ollama.models[0]}
                    onValueChange={(value) => setSelectedOllamaModel(value)}
                  >
                    <SelectTrigger className="w-auto shrink-0">
                      <SelectValue placeholder={t('beta.offlineSettings.selectModel')} />
                    </SelectTrigger>
                    <SelectContent>
                      {ollamaStatus.ollama.models.map((model) => {
                        const isRecommended = model === ollamaStatus.ollama.recommendedModel
                        return (
                          <SelectItem key={model} value={model}>
                            <span className="truncate">
                              {model}
                              {isRecommended && (
                                <span className="text-muted-foreground ml-1 text-xs">(recommended)</span>
                              )}
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Auto-fallback toggle */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {t('beta.offlineSettings.autoOffline')}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t('beta.offlineSettings.autoOfflineHint')}
                  </p>
                </div>
                <Switch
                  checked={autoOffline}
                  onCheckedChange={setAutoOffline}
                />
              </div>

              {/* Installation instructions - always show */}
              <div className="text-xs text-muted-foreground bg-muted p-3 rounded flex flex-col gap-2">
                <p className="font-medium">{t('beta.offlineSettings.setupTitle')}</p>
                <ol className="list-decimal list-inside flex flex-col gap-1 ml-2">
                  <li>
                    Install Ollama {MINIMUM_OLLAMA_VERSION}+ from{" "}
                    <a
                      href="https://ollama.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline inline-flex items-center gap-0.5"
                    >
                      ollama.com
                      <ExternalLinkIcon className="h-3 w-3" />
                    </a>
                  </li>
                  <li>
                    Pull the recommended model:{" "}
                    <code className="relative inline-flex items-center gap-1 bg-background pl-1.5 pr-0.5 py-0.5 rounded-md">
                      <span>ollama pull {RECOMMENDED_MODEL}</span>
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="p-1 hover:bg-muted rounded transition-colors"
                        title={copied ? "Copied!" : "Copy command"}
                      >
                        <div className="relative w-3 h-3">
                          <Copy
                            className={cn(
                              "absolute inset-0 w-3 h-3 text-muted-foreground transition-[opacity,transform] duration-200 ease-out hover:text-foreground",
                              copied ? "opacity-0 scale-50" : "opacity-100 scale-100",
                            )}
                          />
                          <Check
                            className={cn(
                              "absolute inset-0 w-3 h-3 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                              copied ? "opacity-100 scale-100" : "opacity-0 scale-50",
                            )}
                          />
                        </div>
                      </button>
                    </code>
                  </li>
                  <li>Ollama will run automatically in the background</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
