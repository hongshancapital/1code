import { useEffect, useState, useMemo } from "react"
import { motion, AnimatePresence } from "motion/react"
import { useTranslation } from "react-i18next"
import { useAtomValue } from "jotai"
import RotatingText from "./ui/rotating-text"
import { createLogger } from "../lib/logger"
import {
  pipelinePhaseAtom,
  currentStepAtom,
} from "../lib/loading-pipeline"

const log = createLogger("LoadingPipelineScene")

// Word keys for slogan rotation
const WORD_KEYS = [
  "work", "chat", "code", "think", "create", "debug",
  "explore", "learn", "solve", "build", "design",
  "review", "refactor", "assist", "guide", "grow",
] as const

interface LoadingPipelineSceneProps {
  /** Callback when the exit animation finishes — overlay can be unmounted */
  onExitComplete?: () => void
}

/**
 * LoadingPipelineScene — 纯容器组件
 *
 * 渲染双幕（curtain）动画，分三个可 override 的区域：
 * - Logo（上半中心：Hóng + 光晕）
 * - Slogan（上半底部：rotating text）
 * - Bottom（下半部分：内容区域）
 *
 * 根据 pipeline 当前 step 的 ui 配置决定显示默认内容还是 step 自定义内容。
 */
export function LoadingPipelineScene({ onExitComplete }: LoadingPipelineSceneProps) {
  const pipelinePhase = useAtomValue(pipelinePhaseAtom)
  const currentStep = useAtomValue(currentStepAtom)

  const [visible, setVisible] = useState(true)
  const [version, setVersion] = useState<string>("")
  const { t } = useTranslation("common")

  // Get app version
  useEffect(() => {
    window.desktopApi?.getVersion?.().then((v) => {
      if (v) setVersion(v)
    })
  }, [])

  // Random start index for slogan rotation
  const startIndex = useMemo(
    () => Math.floor(Math.random() * WORD_KEYS.length),
    [],
  )

  const words = useMemo(() => {
    const allWords = WORD_KEYS.map((key) => t(`loading.words.${key}`))
    return [...allWords.slice(startIndex), ...allWords.slice(0, startIndex)]
  }, [t, startIndex])

  const prefix = t("loading.prefix")

  // Exit when pipeline is done
  useEffect(() => {
    if (pipelinePhase === "done" && visible) {
      log.info("Pipeline done, starting exit animation")
      setVisible(false)
    }
  }, [pipelinePhase, visible])

  const handleExitComplete = () => {
    onExitComplete?.()
  }

  // ---------------------------------------------------------------------------
  // Resolve what to render per region
  // ---------------------------------------------------------------------------

  const ui = currentStep?.ui

  const showDefaultLogo = !ui?.renderLogo
  const showDefaultSlogan = !ui?.renderSlogan
  const showDefaultBottom = !ui?.renderBottom

  const customLogo = ui?.renderLogo?.()
  const customSlogan = ui?.renderSlogan?.()
  const customBottom = ui?.renderBottom?.()

  // ---------------------------------------------------------------------------
  // Default bottom: loading dots
  // ---------------------------------------------------------------------------

  const defaultBottom = (
    <motion.div
      key="default-loading"
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
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.2,
            }}
          />
        ))}
      </div>
      <motion.p
        className="text-sm md:text-base text-muted-foreground font-medium"
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        {t("loading.initializing")}
      </motion.p>
    </motion.div>
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {visible && (
        <>
          {/* ============ Top half — curtain ============ */}
          <motion.div
            key="top-curtain"
            className="fixed top-0 left-0 right-0 h-1/2 bg-background z-[9999] flex flex-col items-center overflow-hidden"
            initial={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={{ duration: 0.8, ease: [0.43, 0.13, 0.23, 0.96] }}
          >
            {/* Background gradient */}
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-background" />

            {/* Logo region */}
            {showDefaultLogo ? (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-[40px] z-10 flex items-center justify-center">
                {/* Rotating glow */}
                <motion.div
                  className="absolute w-[210px] h-[210px] rounded-full opacity-60 blur-[45px]"
                  style={{
                    background:
                      "conic-gradient(from 180deg, #ff6ec4 0deg, #c471ed 60deg, #7928ca 120deg, #12c2e9 180deg, #00d4aa 240deg, #f7797d 300deg, #ff6ec4 360deg)",
                  }}
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 8,
                    repeat: Infinity,
                    ease: "linear",
                  }}
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
            ) : (
              customLogo
            )}

            {/* Slogan region */}
            <AnimatePresence>
              {showDefaultSlogan ? (
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
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "-120%" }}
                    staggerDuration={0.03}
                    splitLevelClassName="overflow-hidden pb-0.5 sm:pb-1 md:pb-1"
                    transition={{
                      type: "spring",
                      damping: 30,
                      stiffness: 400,
                    }}
                    rotationInterval={2500}
                  />
                </motion.div>
              ) : (
                customSlogan
              )}
            </AnimatePresence>
          </motion.div>

          {/* ============ Center divider ============ */}
          <motion.div
            key="divider"
            className="fixed top-1/2 left-0 right-0 h-[2px] -translate-y-1/2 z-[10000]"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          >
            <div className="w-full h-full bg-gradient-to-r from-transparent via-primary to-transparent" />
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-primary/30 rounded-full blur-3xl"
              animate={{
                scale: [1, 1.3, 1],
                opacity: [0.3, 0.6, 0.3],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </motion.div>

          {/* ============ Bottom half — curtain ============ */}
          <motion.div
            key="bottom-curtain"
            className="fixed bottom-0 left-0 right-0 h-1/2 bg-background z-[9999] flex items-start justify-center overflow-hidden"
            initial={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.8, ease: [0.43, 0.13, 0.23, 0.96] }}
          >
            {/* Background gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-primary/5 to-background" />

            {/* Version — bottom left */}
            {version && (
              <div className="absolute left-4 bottom-4 flex items-center gap-1.5 text-xs text-foreground/30">
                <span>v{version}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gradient-to-r from-pink-500/30 to-purple-500/30 text-foreground/70 uppercase tracking-wider">
                  Inside
                </span>
              </div>
            )}

            {/* Bottom content region */}
            <motion.div
              className="relative z-10 pt-8 flex flex-col items-center gap-6 w-full max-w-md px-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <AnimatePresence mode="wait">
                {showDefaultBottom ? defaultBottom : customBottom}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
