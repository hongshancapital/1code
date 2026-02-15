/**
 * Lite WSS Manager
 *
 * 基于 Node.js WebSocket（ws 包）的 WSS 连接管理器。
 * 支持心跳、自动重连、消息分发。
 *
 * 参数参考 trident: 心跳 8s，重连 [2s, 30s, 30s]
 */

import { EventEmitter } from "events"
import WebSocket from "ws"
import { createLogger } from "../../../lib/logger"

const wssLog = createLogger("WSS")


// 常量
const HEARTBEAT_INTERVAL = 8000
const FIRST_RETRY_DELAY = 2000
const RETRY_INTERVAL = 30000
const MAX_RETRIES = 3
const PONG_TIMEOUT = 10000

export type WssState = "disconnected" | "connecting" | "connected" | "reconnecting"

export interface WssManagerOptions {
  /** WSS 服务地址 */
  getUrl: () => string | null
  /** 获取 auth token */
  getToken: () => Promise<string | null>
  /** token 过期时触发 refresh */
  onTokenExpired?: () => Promise<boolean>
}

export class WssManager extends EventEmitter {
  private ws: WebSocket | null = null
  private state: WssState = "disconnected"
  private heartbeatTimer: NodeJS.Timeout | null = null
  private pongTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private retryCount = 0
  private explicitClose = false

  constructor(private options: WssManagerOptions) {
    super()
    this.setMaxListeners(50)
  }

  getState(): WssState {
    return this.state
  }

  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") return

    const url = this.options.getUrl()
    if (!url) {
      wssLog.warn("URL 未配置，跳过连接")
      return
    }

    const token = await this.options.getToken()
    if (!token) {
      wssLog.warn("无 auth token，跳过连接")
      return
    }

    this.explicitClose = false
    this._setState("connecting")

    try {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      this.ws.on("open", () => {
        wssLog.info("连接成功")
        this.retryCount = 0
        this._setState("connected")
        this._startHeartbeat()
        this.emit("connected")
      })

      this.ws.on("message", (data: Buffer | string) => {
        this._handleMessage(data)
      })

      this.ws.on("pong", () => {
        this._clearPongTimer()
      })

      this.ws.on("close", (code: number, reason: Buffer) => {
        wssLog.info(`连接关闭: ${code} ${reason.toString()}`)
        this._cleanup()

        if (!this.explicitClose) {
          this._scheduleReconnect()
        }

        this.emit("disconnected", { code, reason: reason.toString() })
      })

      this.ws.on("error", (err: Error) => {
        wssLog.error("连接错误:", err.message)
        this.emit("error", err)
      })
    } catch (err) {
      wssLog.error("创建连接失败:", err)
      this._setState("disconnected")
      this._scheduleReconnect()
    }
  }

  /** 发送消息 */
  send(channel: string, data: unknown): boolean {
    if (!this.ws || this.state !== "connected") {
      wssLog.warn("未连接，无法发送消息")
      return false
    }

    try {
      const message = JSON.stringify({ channel, data })
      this.ws.send(message)
      return true
    } catch (err) {
      wssLog.error("发送消息失败:", err)
      return false
    }
  }

  /** 主动断开 */
  disconnect(): void {
    this.explicitClose = true
    this._cleanup()
    if (this.ws) {
      try {
        this.ws.close(1000, "manual close")
      } catch {
        // ignore
      }
      this.ws = null
    }
    this._setState("disconnected")
  }

  // ---------------------------------------------------------------------------
  // 内部方法
  // ---------------------------------------------------------------------------

  private _setState(state: WssState): void {
    if (this.state !== state) {
      this.state = state
      this.emit("stateChange", state)
    }
  }

  private _handleMessage(raw: Buffer | string): void {
    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf-8")
      const parsed = JSON.parse(text)
      const channel = parsed.channel || parsed.type || "unknown"
      const data = parsed.data ?? parsed

      this.emit("message", { channel, data, raw: parsed })
    } catch {
      wssLog.warn("无法解析消息:", String(raw).substring(0, 100))
    }
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.state === "connected") {
        try {
          this.ws.ping()
          this._startPongTimer()
        } catch {
          wssLog.warn("心跳发送失败")
        }
      }
    }, HEARTBEAT_INTERVAL)
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this._clearPongTimer()
  }

  private _startPongTimer(): void {
    this._clearPongTimer()
    this.pongTimer = setTimeout(() => {
      wssLog.warn("Pong 超时，断开重连")
      this.ws?.terminate()
    }, PONG_TIMEOUT)
  }

  private _clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }

  private _scheduleReconnect(): void {
    if (this.explicitClose || this.retryCount >= MAX_RETRIES) {
      if (this.retryCount >= MAX_RETRIES) {
        wssLog.warn(`已达最大重连次数 (${MAX_RETRIES})，停止重连`)
        this.emit("maxRetriesReached")
      }
      this._setState("disconnected")
      return
    }

    const delay = this.retryCount === 0 ? FIRST_RETRY_DELAY : RETRY_INTERVAL
    this.retryCount++

    wssLog.info(`${delay}ms 后重连（第 ${this.retryCount} 次）`)
    this._setState("reconnecting")

    this.reconnectTimer = setTimeout(async () => {
      // 重连前尝试 refresh token
      if (this.options.onTokenExpired) {
        await this.options.onTokenExpired().catch(() => {})
      }
      await this.connect()
    }, delay)
  }

  private _cleanup(): void {
    this._stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
