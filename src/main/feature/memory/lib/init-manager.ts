import { createLogger } from "../../../lib/logger"

const initManagerLog = createLogger("MemoryInitManager")

type InitStatus =
  | { state: "idle" }
  | { state: "initializing"; phase: "model" | "vector-store" | "warmup" }
  | { state: "ready" }
  | { state: "failed"; error: string; retryCount: number; nextRetryAt: number }
  | { state: "retrying"; retryCount: number }

export class MemoryInitManager {
  private static instance: MemoryInitManager | null = null

  private status: InitStatus = { state: "idle" }
  private initPromise: Promise<void> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private readonly MAX_RETRIES = 10 // 最多重试 10 次(约 17 分钟)

  private constructor() {}

  static getInstance(): MemoryInitManager {
    if (!MemoryInitManager.instance) {
      MemoryInitManager.instance = new MemoryInitManager()
    }
    return MemoryInitManager.instance
  }

  /**
   * 统一初始化入口(非阻塞)
   */
  async initialize(): Promise<void> {
    // 已就绪,直接返回
    if (this.status.state === "ready") return

    // 正在初始化,等待完成
    if (this.initPromise) return this.initPromise

    // 正在重试中,等待下次重试(不创建新的 Promise)
    if (this.status.state === "failed" || this.status.state === "retrying") {
      initManagerLog.info("Initialization will be retried automatically")
      return
    }

    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    try {
      initManagerLog.info(`Starting initialization (attempt ${this.retryCount + 1})`)

      // Phase 1: Embedding Model(关键路径,5 分钟超时)
      this.status = { state: "initializing", phase: "model" }
      initManagerLog.info("Phase 1: Initializing embedding model...")

      const { ensureModelDownloaded } = await import("./embeddings")
      await ensureModelDownloaded()
      initManagerLog.info("✓ Embedding model ready")

      // Phase 2: Vector Store(依赖 Phase 1 成功)
      this.status = { state: "initializing", phase: "vector-store" }
      initManagerLog.info("Phase 2: Initializing vector store...")

      const { initVectorStore } = await import("./vector-store")
      await initVectorStore()
      initManagerLog.info("✓ Vector store ready")

      // Phase 3: Warmup(可选,测试查询性能,不阻塞)
      this.status = { state: "initializing", phase: "warmup" }
      initManagerLog.info("Phase 3: Warming up search pipeline...")
      this.warmup().catch((err) => {
        initManagerLog.warn("Warmup failed (non-critical):", err)
      })

      // 成功
      this.status = { state: "ready" }
      this.retryCount = 0 // 重置重试计数
      this.initPromise = null
      initManagerLog.info("✓✓ Memory system initialized successfully")
    } catch (error) {
      initManagerLog.error(`Initialization failed (attempt ${this.retryCount + 1}):`, error)
      this.initPromise = null

      // 超过最大重试次数,放弃
      if (this.retryCount >= this.MAX_RETRIES) {
        this.status = {
          state: "failed",
          error: `Max retries (${this.MAX_RETRIES}) exceeded: ${error instanceof Error ? error.message : String(error)}`,
          retryCount: this.retryCount,
          nextRetryAt: 0 // 不再重试
        }
        initManagerLog.error(`Giving up after ${this.MAX_RETRIES} retries`)
        return
      }

      // 调度重试
      this.scheduleRetry(error as Error)
    }
  }

  private scheduleRetry(error: Error): void {
    const delayMs = Math.min(5_000 * Math.pow(2, this.retryCount), 60_000)
    const nextRetryAt = Date.now() + delayMs

    this.status = {
      state: "failed",
      error: error.message,
      retryCount: this.retryCount,
      nextRetryAt
    }

    initManagerLog.info(`Scheduling retry ${this.retryCount + 1} in ${delayMs / 1000}s`)

    if (this.retryTimer) clearTimeout(this.retryTimer)

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.retryCount++
      this.status = { state: "retrying", retryCount: this.retryCount }
      this.initialize().catch(() => {
        // 重试失败会再次进入 scheduleRetry
      })
    }, delayMs)

    if (this.retryTimer.unref) this.retryTimer.unref() // 不阻止进程退出
  }

  private async warmup(): Promise<void> {
    // 执行一次测试查询,预热 pipeline(可选优化)
    // 不阻塞主流程,失败也不重试
    try {
      const { generateEmbedding } = await import("./embeddings")
      await generateEmbedding("query: warmup test")
      initManagerLog.info("✓ Warmup completed")
    } catch {
      // 忽略 warmup 失败
    }
  }

  /**
   * 获取状态(供前端轮询和 Queue Processing 检查)
   */
  getStatus(): InitStatus {
    return this.status
  }

  /**
   * 手动重试(供前端 Retry 按钮调用)
   */
  async retry(): Promise<void> {
    if (this.status.state === "failed" || this.status.state === "idle") {
      initManagerLog.info("Manual retry triggered")

      // 清除自动重试定时器
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }

      // 重置重试计数(手动重试视为新的尝试)
      this.retryCount = 0
      this.initPromise = null

      return this.initialize()
    }

    initManagerLog.warn("Cannot retry: system is already initializing or ready")
  }

  /**
   * 检查是否就绪(快速检查,不触发初始化)
   */
  isReady(): boolean {
    return this.status.state === "ready"
  }

  /**
   * 清理资源(供测试或应用退出时调用)
   */
  cleanup(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.initPromise = null
  }
}
