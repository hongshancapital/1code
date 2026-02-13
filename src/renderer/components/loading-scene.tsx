import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAtom } from 'jotai'
import confetti from 'canvas-confetti'
import { CheckCircle2, Circle, Loader2, XCircle, ExternalLink } from 'lucide-react'
import RotatingText from './ui/rotating-text'
import { userPersonalizationAtom } from '../lib/atoms'
import { cn } from '../lib/utils'
import { trpc } from '../lib/trpc'

type LoadingStatus = 'initializing' | 'detecting' | 'configuring' | 'ready'

// Environment check phases
type EnvPhase =
  | 'silent_check'          // Non-first launch: silent background check
  | 'checking'              // First launch: checking PM + Git with UI
  | 'installing_pm'         // Auto-installing package manager
  | 'installing_git'        // Auto-installing Git
  | 'install_failed'        // Git installation failed, manual guidance
  | 'recommend'             // Recommend Python/Node.js installation
  | 'installing_recommended' // Installing recommended tools
  | 'name_input'            // Name input step
  | 'done'                  // Environment check complete

// Check item status
type CheckStatus = 'pending' | 'checking' | 'success' | 'failed'

interface CheckItem {
  id: string
  label: string
  status: CheckStatus
}

// Step definition for StepIndicator
interface StepDef {
  id: string
  label: string
  status: 'pending' | 'active' | 'completed'
}

interface LoadingSceneProps {
  isLoading: boolean
  loadingStatus?: LoadingStatus
  /** Whether to show name input (first time onboarding) */
  showNameInput?: boolean
  /** Callback when name input is completed or skipped */
  onNameInputComplete?: () => void
  onLoadingComplete?: () => void
  /** Callback when environment check is complete */
  onEnvCheckComplete?: () => void
}

// Word keys for slogan rotation
const WORD_KEYS = [
  'work', 'chat', 'code', 'think', 'create', 'debug',
  'explore', 'learn', 'solve', 'build', 'design',
  'review', 'refactor', 'assist', 'guide', 'grow'
] as const

// Fire confetti from center
function fireConfetti() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { x: 0.5, y: 0.5 }
  })
}

// Step Indicator Component
function StepIndicator({ steps }: { steps: StepDef[] }) {
  return (
    <div className="flex items-center justify-center mb-6">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center">
          {/* Step: circle + label */}
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "w-3 h-3 rounded-full transition-all duration-300",
                step.status === 'completed' && "bg-primary",
                step.status === 'active' && "bg-primary animate-pulse",
                step.status === 'pending' && "bg-muted-foreground/30"
              )}
            />
            <span
              className={cn(
                "text-xs mt-2 transition-colors text-center whitespace-nowrap",
                step.status === 'completed' && "text-primary",
                step.status === 'active' && "text-foreground",
                step.status === 'pending' && "text-muted-foreground/50"
              )}
            >
              {step.label}
            </span>
          </div>
          {/* Connector line - positioned at circle level */}
          {index < steps.length - 1 && (
            <div
              className={cn(
                "w-12 h-[2px] -mt-6 transition-colors",
                step.status === 'completed' ? "bg-primary" : "bg-muted-foreground/20"
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// Check List Item Component
function CheckListItem({ item }: { item: CheckItem }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {item.status === 'pending' && (
        <Circle className="w-4 h-4 text-muted-foreground/40" />
      )}
      {item.status === 'checking' && (
        <Loader2 className="w-4 h-4 text-primary animate-spin" />
      )}
      {item.status === 'success' && (
        <CheckCircle2 className="w-4 h-4 text-green-500" />
      )}
      {item.status === 'failed' && (
        <XCircle className="w-4 h-4 text-destructive" />
      )}
      <span className={cn(
        "transition-colors",
        item.status === 'success' && "text-foreground",
        item.status === 'checking' && "text-foreground",
        item.status === 'failed' && "text-destructive",
        item.status === 'pending' && "text-muted-foreground/60"
      )}>
        {item.label}
      </span>
    </div>
  )
}

export function LoadingScene({
  isLoading,
  loadingStatus = 'initializing',
  showNameInput = false,
  onNameInputComplete,
  onLoadingComplete,
  onEnvCheckComplete
}: LoadingSceneProps) {
  const [visible, setVisible] = useState(true)
  const [version, setVersion] = useState<string>('')
  const { t } = useTranslation('common')
  const [userPersonalization, setUserPersonalization] = useAtom(userPersonalizationAtom)

  // Environment check state
  // First launch (showNameInput=true) -> full guided flow
  // Non-first launch (showNameInput=false) -> silent check, skip to slogan+loading if Git exists
  const [envPhase, setEnvPhase] = useState<EnvPhase>(
    showNameInput ? 'checking' : 'silent_check'
  )
  const [checkItems, setCheckItems] = useState<CheckItem[]>([
    { id: 'pm', label: t('loading.env.checkingPM'), status: 'pending' },
    { id: 'git', label: t('loading.env.checkingGit'), status: 'pending' }
  ])
  const [missingRecommended, setMissingRecommended] = useState<string[]>([])
  const [installingToolName, setInstallingToolName] = useState<string>('')
  const [gitInstalled, setGitInstalled] = useState(false)
  const envCheckRan = useRef(false)

  // Name input state
  const [nameValue, setNameValue] = useState('')
  const [nameInputDone, setNameInputDone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Get app version
  useEffect(() => {
    window.desktopApi?.getVersion?.().then((v) => {
      if (v) setVersion(v)
    })
  }, [])

  // Random start index for slogan rotation
  const startIndex = useMemo(() => Math.floor(Math.random() * WORD_KEYS.length), [])

  // Get translated words for slogan
  const words = useMemo(() => {
    const allWords = WORD_KEYS.map((key) => t(`loading.words.${key}`))
    return [...allWords.slice(startIndex), ...allWords.slice(0, startIndex)]
  }, [t, startIndex])

  const prefix = t('loading.prefix')

  // Loading status text
  const loadingText = useMemo(() => {
    switch (loadingStatus) {
      case 'detecting': return t('loading.detecting')
      case 'configuring': return t('loading.configuring')
      case 'ready': return t('loading.ready')
      default: return t('loading.initializing')
    }
  }, [loadingStatus, t])

  // tRPC mutations and queries
  const utils = trpc.useUtils()
  const installPMMutation = trpc.runner.installPackageManager.useMutation()
  const installToolMutation = trpc.runner.installTool.useMutation()

  // Helper to detect tools (invalidate cache and refetch)
  const detectTools = useCallback(async () => {
    await utils.runner.detectTools.invalidate()
    return utils.runner.detectTools.fetch()
  }, [utils])

  // Update check item status
  const updateCheckItem = useCallback((id: string, status: CheckStatus) => {
    setCheckItems(prev => prev.map(item =>
      item.id === id ? { ...item, status } : item
    ))
  }, [])

  // Environment check logic
  const runEnvCheck = useCallback(async (isSilent: boolean) => {
    try {
      // Step 1: Detect tools
      updateCheckItem('pm', 'checking')
      const result = await detectTools()

      // Check package manager
      const pmCategory = result.categories.find((c: { category: string; satisfied: boolean }) => c.category === 'package_manager')
      const pmAvailable = pmCategory?.satisfied ?? (result.platform === 'linux')
      updateCheckItem('pm', pmAvailable ? 'success' : 'pending')

      // Check Git
      updateCheckItem('git', 'checking')
      const gitTool = result.tools.find((t: { name: string; installed: boolean }) => t.name === 'git')
      const hasGit = gitTool?.installed ?? false

      if (hasGit) {
        updateCheckItem('git', 'success')
        setGitInstalled(true)

        // If silent check and Git exists, go directly to done
        if (isSilent) {
          setEnvPhase('done')
          onEnvCheckComplete?.()
          return
        }

        // First launch: show confetti and continue to recommended/name-input
        fireConfetti()

        // Check for recommended tools (Python, Node.js)
        const missing: string[] = []
        const pythonTool = result.tools.find((t: { name: string; installed: boolean }) => t.name === 'python3' || t.name === 'python')
        const nodeTool = result.tools.find((t: { name: string; installed: boolean }) => t.name === 'node')
        if (!pythonTool?.installed) missing.push('Python')
        if (!nodeTool?.installed) missing.push('Node.js')
        setMissingRecommended(missing)

        // Determine next phase
        if (missing.length > 0) {
          setEnvPhase('recommend')
        } else if (showNameInput && !nameInputDone) {
          setEnvPhase('name_input')
        } else {
          setEnvPhase('done')
          onEnvCheckComplete?.()
        }
        return
      }

      // Git not installed
      updateCheckItem('git', 'failed')

      // Silent mode but Git missing -> switch to guided flow (but skip name and recommend)
      if (isSilent) {
        setEnvPhase('checking')
        // Re-run in guided mode (will try to install)
        return runEnvCheck(false)
      }

      // Need to install Git - first ensure PM
      if (!pmAvailable) {
        setEnvPhase('installing_pm')
        try {
          await installPMMutation.mutateAsync()
          updateCheckItem('pm', 'success')
        } catch {
          // PM install failed, but we can still try Git with fallback
          updateCheckItem('pm', 'failed')
        }
      }

      // Install Git
      setEnvPhase('installing_git')
      setInstallingToolName('Git')
      try {
        await installToolMutation.mutateAsync({ toolName: 'git', command: 'git' })
        updateCheckItem('git', 'success')
        setGitInstalled(true)
        fireConfetti()

        // Check recommended tools
        const refreshResult = await detectTools()
        const missing: string[] = []
        const pythonTool = refreshResult.tools.find((t: { name: string; installed: boolean }) => t.name === 'python3' || t.name === 'python')
        const nodeTool = refreshResult.tools.find((t: { name: string; installed: boolean }) => t.name === 'node')
        if (!pythonTool?.installed) missing.push('Python')
        if (!nodeTool?.installed) missing.push('Node.js')
        setMissingRecommended(missing)

        if (missing.length > 0 && showNameInput) {
          setEnvPhase('recommend')
        } else if (showNameInput && !nameInputDone) {
          setEnvPhase('name_input')
        } else {
          setEnvPhase('done')
          onEnvCheckComplete?.()
        }
      } catch {
        // Git install failed
        setEnvPhase('install_failed')
      }
    } catch (error) {
      console.error('[LoadingScene] Env check error:', error)
      // On any error, just mark as done and let user proceed
      setEnvPhase('done')
      onEnvCheckComplete?.()
    }
  }, [
    detectTools, installPMMutation, installToolMutation,
    updateCheckItem, showNameInput, nameInputDone, onEnvCheckComplete
  ])

  // Run environment check on mount
  useEffect(() => {
    if (envCheckRan.current) return
    envCheckRan.current = true

    const isSilent = envPhase === 'silent_check'
    runEnvCheck(isSilent)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle retry
  const handleRetry = useCallback(() => {
    setCheckItems([
      { id: 'pm', label: t('loading.env.checkingPM'), status: 'pending' },
      { id: 'git', label: t('loading.env.checkingGit'), status: 'pending' }
    ])
    setEnvPhase('checking')
    envCheckRan.current = false
    runEnvCheck(false)
  }, [t, runEnvCheck])

  // Handle download Git
  const handleDownloadGit = useCallback(() => {
    const platform = window.desktopApi?.platform
    const url = platform === 'win32'
      ? 'https://git-scm.com/download/win'
      : 'https://git-scm.com/downloads'
    window.desktopApi?.openExternal?.(url)
  }, [])

  // Handle skip (install failed)
  const handleSkipEnv = useCallback(() => {
    setEnvPhase('done')
    onEnvCheckComplete?.()
  }, [onEnvCheckComplete])

  // Handle recommend install
  const handleInstallRecommended = useCallback(async () => {
    setEnvPhase('installing_recommended')
    for (const toolName of missingRecommended) {
      setInstallingToolName(toolName)
      try {
        const actualName = toolName === 'Python' ? 'python3' : 'node'
        await installToolMutation.mutateAsync({ toolName: actualName, command: actualName })
      } catch {
        // Ignore errors, continue with next
      }
    }
    fireConfetti()
    if (showNameInput && !nameInputDone) {
      setEnvPhase('name_input')
    } else {
      setEnvPhase('done')
      onEnvCheckComplete?.()
    }
  }, [missingRecommended, installToolMutation, showNameInput, nameInputDone, onEnvCheckComplete])

  // Handle skip recommended
  const handleSkipRecommended = useCallback(() => {
    if (showNameInput && !nameInputDone) {
      setEnvPhase('name_input')
    } else {
      setEnvPhase('done')
      onEnvCheckComplete?.()
    }
  }, [showNameInput, nameInputDone, onEnvCheckComplete])

  // Auto-focus input when name input phase
  useEffect(() => {
    if (envPhase === 'name_input' && inputRef.current) {
      const timer = setTimeout(() => inputRef.current?.focus(), 300)
      return () => clearTimeout(timer)
    }
  }, [envPhase])

  // Handle name confirmation
  const handleConfirmName = useCallback(() => {
    if (nameValue.trim()) {
      setUserPersonalization({
        ...userPersonalization,
        preferredName: nameValue.trim().slice(0, 50)
      })
    }
    setNameInputDone(true)
    onNameInputComplete?.()
    setEnvPhase('done')
    onEnvCheckComplete?.()
  }, [nameValue, userPersonalization, setUserPersonalization, onNameInputComplete, onEnvCheckComplete])

  // Handle skip name
  const handleSkipName = useCallback(() => {
    setNameInputDone(true)
    onNameInputComplete?.()
    setEnvPhase('done')
    onEnvCheckComplete?.()
  }, [onNameInputComplete, onEnvCheckComplete])

  // Build steps for StepIndicator
  // 环境准备 - 系统必要能力 - 系统可选能力 - 认识一下
  const steps = useMemo((): StepDef[] => {
    const list: StepDef[] = []

    // Step 1: 环境准备 (Package Manager)
    const pmCompleted = envPhase !== 'checking' && envPhase !== 'installing_pm'
    const pmActive = envPhase === 'checking' || envPhase === 'installing_pm'
    list.push({
      id: 'env',
      label: t('loading.env.stepEnv'),
      status: pmCompleted ? 'completed' : pmActive ? 'active' : 'pending'
    })

    // Step 2: 系统必要能力 (Git)
    const requiredCompleted = gitInstalled || envPhase === 'install_failed' || envPhase === 'recommend' ||
      envPhase === 'installing_recommended' || envPhase === 'name_input' || envPhase === 'done'
    const requiredActive = envPhase === 'installing_git'
    list.push({
      id: 'required',
      label: t('loading.env.stepRequired'),
      status: requiredCompleted ? 'completed' : requiredActive ? 'active' : 'pending'
    })

    // Step 3: 系统可选能力 (Python/Node.js) - only if first launch
    if (showNameInput) {
      const recommendCompleted = envPhase === 'name_input' || envPhase === 'done'
      const recommendActive = envPhase === 'recommend' || envPhase === 'installing_recommended'
      list.push({
        id: 'recommend',
        label: t('loading.env.stepRecommend'),
        status: recommendCompleted ? 'completed' : recommendActive ? 'active' : 'pending'
      })
    }

    // Step 4: 认识一下 (Name input) - only if first launch
    if (showNameInput) {
      const nameCompleted = nameInputDone || envPhase === 'done'
      const nameActive = envPhase === 'name_input'
      list.push({
        id: 'name',
        label: t('loading.env.stepName'),
        status: nameCompleted ? 'completed' : nameActive ? 'active' : 'pending'
      })
    }

    return list
  }, [envPhase, gitInstalled, showNameInput, nameInputDone, t])

  // Determine if we should show guided UI or slogan+loading
  // Show guided UI for first launch OR when Git is missing on non-first launch
  const showGuidedUI = envPhase !== 'done' && envPhase !== 'silent_check'
  // Show slogan when: done, silent_check, or name_input phase (认识一下)
  const showSlogan = envPhase === 'done' || envPhase === 'silent_check' || envPhase === 'name_input'

  // Determine if we can exit
  const canExit = envPhase === 'done' && !isLoading && (!showNameInput || nameInputDone)

  useEffect(() => {
    if (canExit && visible) {
      setVisible(false)
    }
  }, [canExit, visible])

  // Exit animation complete
  const handleExitComplete = () => {
    onLoadingComplete?.()
  }

  // Render bottom half content based on phase
  const renderBottomContent = () => {
    // Silent check or done: show loading indicator
    if (envPhase === 'silent_check' || envPhase === 'done') {
      return (
        <motion.div
          key="loading-indicator"
          className="flex flex-col items-center gap-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center gap-2">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2.5 h-2.5 rounded-full bg-primary"
                animate={{
                  scale: [1, 1.3, 1],
                  opacity: [0.5, 1, 0.5]
                }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * 0.2
                }}
              />
            ))}
          </div>
          <motion.p
            className="text-sm md:text-base text-muted-foreground font-medium"
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            {loadingText}
          </motion.p>
        </motion.div>
      )
    }

    // Guided UI phases
    return (
      <motion.div
        key="guided-ui"
        className="flex flex-col items-center gap-4 w-full"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
      >
        {/* Step Indicator */}
        <StepIndicator steps={steps} />

        {/* Environment checking phase */}
        {(envPhase === 'checking' || envPhase === 'installing_pm' || envPhase === 'installing_git') && (
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-col gap-2">
              {checkItems.map(item => (
                <CheckListItem key={item.id} item={item} />
              ))}
            </div>
            {(envPhase === 'installing_pm' || envPhase === 'installing_git') && (
              <p className="text-xs text-muted-foreground">
                {t('loading.env.mayTakeMinutes')}
              </p>
            )}
          </div>
        )}

        {/* Install failed phase */}
        {envPhase === 'install_failed' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-destructive">
                {t('loading.env.failed')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('loading.env.failedDesc')}
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              <button
                onClick={handleDownloadGit}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                {t('loading.env.downloadGit')}
              </button>
              <button
                onClick={handleRetry}
                className="px-4 py-2.5 rounded-lg border border-border text-foreground font-medium hover:bg-accent transition-colors"
              >
                {t('loading.env.recheck')}
              </button>
              <button
                onClick={handleSkipEnv}
                className="px-4 py-2.5 rounded-lg border border-border text-muted-foreground font-medium hover:bg-accent transition-colors"
              >
                {t('loading.env.skip')}
              </button>
            </div>
          </div>
        )}

        {/* Recommend phase */}
        {envPhase === 'recommend' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">
                {t('loading.env.recommend')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('loading.env.recommendDesc')}
              </p>
            </div>
            <div className="flex gap-3 w-full max-w-xs">
              <button
                onClick={handleInstallRecommended}
                className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors text-sm"
              >
                {t('loading.env.installRecommended')}
              </button>
              <button
                onClick={handleSkipRecommended}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border text-foreground font-medium hover:bg-accent transition-colors text-sm"
              >
                {t('loading.env.skipRecommended')}
              </button>
            </div>
          </div>
        )}

        {/* Installing recommended phase */}
        {envPhase === 'installing_recommended' && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">
              {t('loading.env.installingRecommended', { name: installingToolName })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('loading.env.mayTakeMinutes')}
            </p>
          </div>
        )}

        {/* Name input phase */}
        {envPhase === 'name_input' && (
          <div className="flex flex-col items-center gap-5 w-full">
            <div className="flex flex-col items-center gap-2">
              <p className="text-base text-foreground">
                {t('loading.nameInput.question')}
              </p>
              <p className="text-lg md:text-xl text-foreground font-medium">
                {t('loading.nameInput.subtitle')}
              </p>
            </div>

            <input
              ref={inputRef}
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                // 跳过 IME 组合状态中的回车（中文输入法确认）
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && nameValue.trim()) {
                  handleConfirmName()
                }
              }}
              placeholder={t('loading.nameInput.placeholder')}
              maxLength={50}
              className="w-full max-w-xs px-4 py-2.5 rounded-lg border border-border bg-background/80 backdrop-blur-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-center"
            />

            {/* Equal-sized buttons */}
            <div className="flex gap-3 w-full max-w-xs">
              <button
                onClick={handleConfirmName}
                disabled={!nameValue.trim()}
                className={cn(
                  "flex-1 px-4 py-2.5 rounded-lg font-medium transition-all",
                  nameValue.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                {t('loading.nameInput.letsGo')}
              </button>
              <button
                onClick={handleSkipName}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border text-foreground font-medium hover:bg-accent transition-colors"
              >
                {t('loading.nameInput.skip')}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    )
  }

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {visible && (
        <>
          {/* Top half - curtain reveal */}
          <motion.div
            key="top-curtain"
            className="fixed top-0 left-0 right-0 h-1/2 bg-background z-[9999] flex flex-col items-center overflow-hidden"
            initial={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{ duration: 0.8, ease: [0.43, 0.13, 0.23, 0.96] }}
          >
            {/* Background gradient */}
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-background" />

            {/* Hóng text and glow - centered */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-[40px] z-10 flex items-center justify-center">
              {/* Rotating glow */}
              <motion.div
                className="absolute w-[210px] h-[210px] rounded-full opacity-60 blur-[45px]"
                style={{
                  background: 'conic-gradient(from 180deg, #ff6ec4 0deg, #c471ed 60deg, #7928ca 120deg, #12c2e9 180deg, #00d4aa 240deg, #f7797d 300deg, #ff6ec4 360deg)'
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              />
              {/* Hóng text */}
              <motion.span
                className="relative z-10 text-7xl md:text-8xl font-bold text-foreground"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                Hóng
              </motion.span>
            </div>

            {/* Slogan - only show when done or silent_check */}
            <AnimatePresence>
              {showSlogan && (
                <motion.div
                  className="absolute bottom-6 left-0 right-0 z-10 flex items-center justify-center gap-3 md:gap-4"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{ duration: 0.4 }}
                >
                  <motion.span
                    className="text-3xl md:text-5xl lg:text-6xl font-bold text-foreground"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                  >
                    {prefix}
                  </motion.span>
                  <RotatingText
                    texts={words}
                    mainClassName="px-3 sm:px-4 md:px-5 bg-primary text-primary-foreground overflow-hidden py-1 sm:py-1.5 md:py-2 justify-center rounded-lg text-3xl md:text-5xl lg:text-6xl font-bold shadow-lg transition-all"
                    staggerFrom="last"
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '-120%' }}
                    staggerDuration={0.03}
                    splitLevelClassName="overflow-hidden pb-0.5 sm:pb-1 md:pb-1"
                    transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                    rotationInterval={2500}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Center divider */}
          <motion.div
            key="divider"
            className="fixed top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 z-[10000]"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            <div className="w-full h-full bg-gradient-to-r from-transparent via-primary to-transparent" />
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-primary/30 rounded-full blur-3xl"
              animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>

          {/* Bottom half - curtain reveal */}
          <motion.div
            key="bottom-curtain"
            className="fixed bottom-0 left-0 right-0 h-1/2 bg-background z-[9999] flex items-start justify-center overflow-hidden"
            initial={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.8, ease: [0.43, 0.13, 0.23, 0.96] }}
          >
            {/* Background gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-background" />

            {/* Version - bottom left */}
            {version && (
              <div className="absolute left-4 bottom-4 flex items-center gap-1.5 text-xs text-foreground/30">
                <span>v{version}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gradient-to-r from-pink-500/30 to-purple-500/30 text-foreground/70 uppercase tracking-wider">
                  Inside
                </span>
              </div>
            )}

            {/* Content area */}
            <motion.div
              className="relative z-10 pt-8 flex flex-col items-center gap-6 w-full max-w-md px-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <AnimatePresence mode="wait">
                {renderBottomContent()}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
