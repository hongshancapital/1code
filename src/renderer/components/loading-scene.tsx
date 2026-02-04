import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import RotatingText from './ui/rotating-text'

interface LoadingSceneProps {
  isLoading: boolean
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

export function LoadingScene({ isLoading, onLoadingComplete }: LoadingSceneProps) {
  const [visible, setVisible] = useState(true)
  const { t } = useTranslation('common')

  // 随机起始索引，每次刷新都不同
  const startIndex = useMemo(() => Math.floor(Math.random() * WORD_KEYS.length), [])

  // 从 i18n 获取翻译后的词汇列表，从随机位置开始
  const words = useMemo(() => {
    const allWords = WORD_KEYS.map((key) => t(`loading.words.${key}`))
    // 从 startIndex 开始重新排列
    return [...allWords.slice(startIndex), ...allWords.slice(0, startIndex)]
  }, [t, startIndex])

  const prefix = t('loading.prefix')
  const loadingText = t('loading.initializing')

  useEffect(() => {
    if (!isLoading && visible) {
      // 数据加载完成，触发退出动画
      setVisible(false)
    }
  }, [isLoading, visible])

  // 退出动画完成后通知父组件
  const handleExitComplete = () => {
    onLoadingComplete?.()
  }

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {visible && (
        <>
          {/* 上半部分 - 揭幕效果 */}
          <motion.div
            key="top-curtain"
            className="fixed top-0 left-0 right-0 h-1/2 bg-background z-[9999] flex items-end justify-center overflow-hidden"
            initial={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{ duration: 0.8, ease: [0.43, 0.13, 0.23, 0.96] }}
          >
            {/* 上半部分的背景渐变 */}
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-background" />

            {/* 文字内容 - 定位在中间分割线附近 */}
            <div className="relative z-10 pb-6 flex items-center gap-3 md:gap-4">
              <motion.span
                className="text-3xl md:text-5xl lg:text-6xl font-bold text-foreground"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5 }}
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

            {/* 加载指示器 - 定位在中间分割线附近 */}
            <motion.div
              className="relative z-10 pt-8 flex flex-col items-center gap-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
