import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAtom } from 'jotai'
import RotatingText from './ui/rotating-text'
import { userPersonalizationAtom } from '../lib/atoms'
import { cn } from '../lib/utils'

type LoadingStatus = 'initializing' | 'detecting' | 'configuring' | 'ready'

interface LoadingSceneProps {
  isLoading: boolean
  loadingStatus?: LoadingStatus
  /** Whether to show name input (first time onboarding) */
  showNameInput?: boolean
  /** Callback when name input is completed or skipped */
  onNameInputComplete?: () => void
  onLoadingComplete?: () => void
}

// 词汇的 key 列表，work 在第一位形成 Co + Work = Cowork
const WORD_KEYS = [
  'work',
  'chat',
  'code',
  'think',
  'create',
  'debug',
  'explore',
  'learn',
  'solve',
  'build',
  'design',
  'review',
  'refactor',
  'assist',
  'guide',
  'grow'
] as const

export function LoadingScene({
  isLoading,
  loadingStatus = 'initializing',
  showNameInput = false,
  onNameInputComplete,
  onLoadingComplete
}: LoadingSceneProps) {
  const [visible, setVisible] = useState(true)
  const [version, setVersion] = useState<string>('')
  const { t } = useTranslation('common')
  const [userPersonalization, setUserPersonalization] = useAtom(userPersonalizationAtom)

  // Get app version
  useEffect(() => {
    window.desktopApi?.getVersion?.().then((v) => {
      if (v) setVersion(v)
    })
  }, [])

  // Name input state
  const [nameValue, setNameValue] = useState('')
  const [nameInputDone, setNameInputDone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 随机起始索引，每次刷新都不同
  const startIndex = useMemo(() => Math.floor(Math.random() * WORD_KEYS.length), [])

  // 从 i18n 获取翻译后的词汇列表，从随机位置开始
  const words = useMemo(() => {
    const allWords = WORD_KEYS.map((key) => t(`loading.words.${key}`))
    // 从 startIndex 开始重新排列
    return [...allWords.slice(startIndex), ...allWords.slice(0, startIndex)]
  }, [t, startIndex])

  const prefix = t('loading.prefix')

  // 根据加载状态显示不同的文案
  const loadingText = useMemo(() => {
    switch (loadingStatus) {
      case 'detecting':
        return t('loading.detecting')
      case 'configuring':
        return t('loading.configuring')
      case 'ready':
        return t('loading.ready')
      default:
        return t('loading.initializing')
    }
  }, [loadingStatus, t])

  // Auto-focus input when name input is shown
  useEffect(() => {
    if (showNameInput && !nameInputDone && inputRef.current) {
      // Delay focus to allow animation to complete
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [showNameInput, nameInputDone])

  // Handle name confirmation
  const handleConfirmName = useCallback(() => {
    if (nameValue.trim()) {
      setUserPersonalization({
        ...userPersonalization,
        preferredName: nameValue.trim().slice(0, 50) // Max 50 chars
      })
    }
    setNameInputDone(true)
    onNameInputComplete?.()
  }, [nameValue, userPersonalization, setUserPersonalization, onNameInputComplete])

  // Handle skip
  const handleSkip = useCallback(() => {
    setNameInputDone(true)
    onNameInputComplete?.()
  }, [onNameInputComplete])


  // Determine if we can exit
  // Exit when: not loading AND (no name input OR name input done)
  const canExit = !isLoading && (!showNameInput || nameInputDone)

  useEffect(() => {
    if (canExit && visible) {
      // 数据加载完成，触发退出动画
      setVisible(false)
    }
  }, [canExit, visible])

  // 退出动画完成后通知父组件
  const handleExitComplete = () => {
    onLoadingComplete?.()
  }

  // Show name input section (in bottom half)
  const showNameInputSection = showNameInput && !nameInputDone

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {visible && (
        <>
          {/* 上半部分 - 揭幕效果 */}
          <motion.div
            key="top-curtain"
            className="fixed top-0 left-0 right-0 h-1/2 bg-background z-[9999] flex flex-col items-center overflow-hidden"
            initial={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{ duration: 0.8, ease: [0.43, 0.13, 0.23, 0.96] }}
          >
            {/* 上半部分的背景渐变 */}
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-background" />

            {/* Hóng 文字和光晕 - 使用绝对定位居中 */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-[40px] z-10 flex items-center justify-center">
              {/* 旋转光晕 - 缩小25% */}
              <motion.div
                className="absolute w-[210px] h-[210px] rounded-full opacity-60 blur-[45px]"
                style={{
                  background: 'conic-gradient(from 180deg, #ff6ec4 0deg, #c471ed 60deg, #7928ca 120deg, #12c2e9 180deg, #00d4aa 240deg, #f7797d 300deg, #ff6ec4 360deg)'
                }}
                animate={{ rotate: 360 }}
                transition={{
                  duration: 8,
                  repeat: Infinity,
                  ease: 'linear'
                }}
              />
              {/* Hóng 大字 */}
              <motion.span
                className="relative z-10 text-7xl md:text-8xl font-bold text-foreground"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                Hóng
              </motion.span>
            </div>

            {/* 文字内容 - 固定在底部 */}
            <div className="absolute bottom-6 left-0 right-0 z-10 flex items-center justify-center gap-3 md:gap-4">
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
                mainClassName="px-3 sm:px-4 md:px-5 bg-primary text-primary-foreground overflow-hidden py-1 sm:py-1.5 md:py-2 justify-center rounded-lg text-3xl md:text-5xl lg:text-6xl font-bold shadow-lg"
                staggerFrom="last"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '-120%' }}
                staggerDuration={0.03}
                splitLevelClassName="overflow-hidden pb-0.5 sm:pb-1 md:pb-1"
                transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                rotationInterval={2500}
              />
            </div>
          </motion.div>

          {/* 中间分割线 */}
          <motion.div
            key="divider"
            className="fixed top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 z-[10000]"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            <div className="w-full h-full bg-gradient-to-r from-transparent via-primary to-transparent" />
            {/* 光晕效果 */}
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-primary/30 rounded-full blur-3xl"
              animate={{
                scale: [1, 1.3, 1],
                opacity: [0.3, 0.6, 0.3]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut'
              }}
            />
          </motion.div>

          {/* 下半部分 - 揭幕效果 */}
          <motion.div
            key="bottom-curtain"
            className="fixed bottom-0 left-0 right-0 h-1/2 bg-background z-[9999] flex items-start justify-center overflow-hidden"
            initial={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.8, ease: [0.43, 0.13, 0.23, 0.96] }}
          >
            {/* 下半部分的背景渐变 */}
            <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-background" />

            {/* 版本号 - 左下角 */}
            {version && (
              <div className="absolute left-4 bottom-4 flex items-center gap-1.5 text-xs text-foreground/30">
                <span>v{version}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gradient-to-r from-pink-500/30 to-purple-500/30 text-foreground/70 uppercase tracking-wider">
                  Inside
                </span>
              </div>
            )}

            {/* 内容区域 */}
            <motion.div
              className="relative z-10 pt-8 flex flex-col items-center gap-6 w-full max-w-md px-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              {/* 名字输入区域 */}
              <AnimatePresence mode="wait">
                {showNameInputSection ? (
                  <motion.div
                    key="name-input"
                    className="flex flex-col items-center gap-5 w-full"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                  >
                    {/* 问题文案 - 与设置页一致 */}
                    <div className="flex flex-col items-center gap-1">
                      <p className="text-base md:text-lg text-foreground font-medium">
                        {t('loading.nameInput.question')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('loading.nameInput.subtitle')}
                      </p>
                    </div>

                    {/* 输入框 - 居中 */}
                    <input
                      ref={inputRef}
                      type="text"
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      placeholder={t('loading.nameInput.placeholder')}
                      maxLength={50}
                      className="w-full max-w-xs px-4 py-2.5 rounded-lg border border-border bg-background/80 backdrop-blur-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-center"
                    />

                    {/* Let's go 按钮 */}
                    <button
                      onClick={handleConfirmName}
                      disabled={!nameValue.trim()}
                      className={cn(
                        "px-6 py-2.5 rounded-lg font-medium transition-all",
                        nameValue.trim()
                          ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md"
                          : "bg-muted text-muted-foreground cursor-not-allowed"
                      )}
                    >
                      {t('loading.nameInput.letsGo')}
                    </button>

                    {/* Skip 文字链接 - 弱化显示在最下方 */}
                    <button
                      onClick={handleSkip}
                      className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                      {t('loading.nameInput.skip')}
                    </button>
                  </motion.div>
                ) : (
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
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: 'easeInOut'
                      }}
                    >
                      {loadingText}
                    </motion.p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
