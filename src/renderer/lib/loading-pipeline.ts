import { type ReactNode } from "react"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import { useCallback, useEffect, useRef } from "react"
import { createLogger } from "./logger"

const log = createLogger("LoadingPipeline")

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum LoadingStepPriority {
  Critical = 0,
  Migration = 10,
  Auth = 20,
  Optional = 30,
}

export interface LoadingStepUI {
  /** 自定义 logo 区域（提供则 override 默认的 Hóng + 光晕） */
  renderLogo?: () => ReactNode
  /** 自定义 slogan 区域（提供则 override 默认的 rotating text） */
  renderSlogan?: () => ReactNode
  /** 自定义下半部分内容区域（提供则 override 默认的 loading 指示器） */
  renderBottom?: () => ReactNode
}

export interface LoadingStep {
  /** 唯一标识 */
  id: string
  /** 优先级，数字越小越先执行 */
  priority: LoadingStepPriority | number
  /** 是否应该激活（返回 false 则跳过此 step） */
  shouldActivate: () => boolean | Promise<boolean>
  /** UI 配置 */
  ui: LoadingStepUI
  /** 生命周期：step 被激活时调用 */
  onActivate?: () => void | Promise<void>
  /** 生命周期：step 完成时调用 */
  onComplete?: () => void
  /** 生命周期：step 出错时调用 */
  onError?: (error: Error) => void
  /** 生命周期：step 被跳过时调用 */
  onSkip?: () => void
}

export type PipelinePhase = "registering" | "running" | "done"

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

/** 已注册的 steps（未排序） */
export const loadingStepsAtom = atom<LoadingStep[]>([])

/** 当前活跃 step 的 id */
export const currentStepIdAtom = atom<string | null>(null)

/** 已完成/跳过的 step ids */
export const completedStepIdsAtom = atom<Set<string>>(new Set())

/** Pipeline 阶段 */
export const pipelinePhaseAtom = atom<PipelinePhase>("registering")

/** 派生 atom：当前活跃的 step 对象 */
export const currentStepAtom = atom<LoadingStep | null>((get) => {
  const stepId = get(currentStepIdAtom)
  if (!stepId) return null
  const steps = get(loadingStepsAtom)
  return steps.find((s) => s.id === stepId) ?? null
})

/** 派生 atom：按 priority 排序后的 step 列表 */
export const sortedStepsAtom = atom<LoadingStep[]>((get) => {
  const steps = get(loadingStepsAtom)
  return [...steps].sort((a, b) => a.priority - b.priority)
})

// ---------------------------------------------------------------------------
// Hook: useLoadingPipeline
// ---------------------------------------------------------------------------

export function useLoadingPipeline() {
  const setSteps = useSetAtom(loadingStepsAtom)
  const setCurrentStepId = useSetAtom(currentStepIdAtom)
  const [completedIds, setCompletedIds] = useAtom(completedStepIdsAtom)
  const setPipelinePhase = useSetAtom(pipelinePhaseAtom)
  const sortedSteps = useAtomValue(sortedStepsAtom)

  // 用 ref 追踪 advancing 状态，避免并发推进
  const advancingRef = useRef(false)

  const register = useCallback(
    (step: LoadingStep) => {
      setSteps((prev) => {
        // 去重：如果已注册同 id 的 step，替换之
        const filtered = prev.filter((s) => s.id !== step.id)
        log.info(`Register step: ${step.id} (priority=${step.priority})`)
        return [...filtered, step]
      })
    },
    [setSteps],
  )

  const advanceToNext = useCallback(
    async (fromStepId: string) => {
      if (advancingRef.current) return
      advancingRef.current = true

      try {
        const currentIndex = sortedSteps.findIndex((s) => s.id === fromStepId)
        const remaining = sortedSteps.slice(currentIndex + 1)

        for (const step of remaining) {
          try {
            const shouldActivate = await step.shouldActivate()
            if (shouldActivate) {
              log.info(`Activate step: ${step.id}`)
              setCurrentStepId(step.id)
              try {
                await step.onActivate?.()
              } catch (err) {
                log.error(`Step ${step.id} onActivate error:`, err)
                step.onError?.(err instanceof Error ? err : new Error(String(err)))
              }
              return // 等待这个 step 调用 complete/skip
            }
            // shouldActivate 返回 false，跳过
            log.info(`Skip step: ${step.id} (shouldActivate=false)`)
            step.onSkip?.()
            setCompletedIds((prev) => new Set([...prev, step.id]))
          } catch (err) {
            log.error(`Step ${step.id} shouldActivate error:`, err)
            step.onError?.(err instanceof Error ? err : new Error(String(err)))
            step.onSkip?.()
            setCompletedIds((prev) => new Set([...prev, step.id]))
          }
        }

        // 所有 step 已完成
        log.info("All steps completed, pipeline done")
        setCurrentStepId(null)
        setPipelinePhase("done")
      } finally {
        advancingRef.current = false
      }
    },
    [sortedSteps, setCurrentStepId, setCompletedIds, setPipelinePhase],
  )

  const complete = useCallback(
    (stepId: string) => {
      log.info(`Complete step: ${stepId}`)
      const step = sortedSteps.find((s) => s.id === stepId)
      step?.onComplete?.()
      setCompletedIds((prev) => new Set([...prev, stepId]))
      advanceToNext(stepId)
    },
    [sortedSteps, setCompletedIds, advanceToNext],
  )

  const skip = useCallback(
    (stepId: string) => {
      log.info(`Skip step: ${stepId}`)
      const step = sortedSteps.find((s) => s.id === stepId)
      step?.onSkip?.()
      setCompletedIds((prev) => new Set([...prev, stepId]))
      advanceToNext(stepId)
    },
    [sortedSteps, setCompletedIds, advanceToNext],
  )

  const error = useCallback(
    (stepId: string, err: Error) => {
      log.error(`Step error: ${stepId}`, err)
      const step = sortedSteps.find((s) => s.id === stepId)
      step?.onError?.(err)
    },
    [sortedSteps],
  )

  const start = useCallback(async () => {
    log.info(`Pipeline start, ${sortedSteps.length} steps registered`)
    setPipelinePhase("running")

    if (sortedSteps.length === 0) {
      log.info("No steps registered, pipeline done immediately")
      setPipelinePhase("done")
      return
    }

    // 从第一个 step 开始
    for (const step of sortedSteps) {
      try {
        const shouldActivate = await step.shouldActivate()
        if (shouldActivate) {
          log.info(`Activate first step: ${step.id}`)
          setCurrentStepId(step.id)
          try {
            await step.onActivate?.()
          } catch (err) {
            log.error(`Step ${step.id} onActivate error:`, err)
            step.onError?.(err instanceof Error ? err : new Error(String(err)))
          }
          return // 等待 complete/skip
        }
        // 跳过
        log.info(`Skip step: ${step.id} (shouldActivate=false)`)
        step.onSkip?.()
        setCompletedIds((prev) => new Set([...prev, step.id]))
      } catch (err) {
        log.error(`Step ${step.id} shouldActivate error:`, err)
        step.onError?.(err instanceof Error ? err : new Error(String(err)))
        step.onSkip?.()
        setCompletedIds((prev) => new Set([...prev, step.id]))
      }
    }

    // 所有 step 都被跳过
    log.info("All steps skipped, pipeline done")
    setCurrentStepId(null)
    setPipelinePhase("done")
  }, [sortedSteps, setCurrentStepId, setCompletedIds, setPipelinePhase])

  return { register, complete, skip, error, start }
}

// ---------------------------------------------------------------------------
// Hook: useLoadingPipelineStart
// ---------------------------------------------------------------------------

/**
 * 在所有 step 注册完成后的下一个 tick 启动 pipeline。
 * 利用 useEffect 的时序：子组件的 useEffect（注册 step）先于父组件的 useEffect 执行，
 * 所以在这个 hook 的 useEffect 中调用 start() 时，所有 step 已注册完毕。
 */
export function useLoadingPipelineStart() {
  const { start } = useLoadingPipeline()
  const phase = useAtomValue(pipelinePhaseAtom)
  const startedRef = useRef(false)

  useEffect(() => {
    if (phase === "registering" && !startedRef.current) {
      startedRef.current = true
      // 延迟到下一个微任务，确保所有同步注册完成
      queueMicrotask(() => {
        start()
      })
    }
  }, [phase, start])
}
