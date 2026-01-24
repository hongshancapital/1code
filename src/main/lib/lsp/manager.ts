/**
 * LSP Manager - Manages Language Server processes
 *
 * Currently supports:
 * - tsserver (TypeScript/JavaScript)
 * - tsgo (TypeScript Go port - beta, requires manual installation)
 */

import { spawn, ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { resolve, dirname } from "node:path"
import { access } from "node:fs/promises"
import { app } from "electron"
import type {
  LSPSession,
  LSPConfig,
  LSPLanguage,
  TsServerRequest,
  TsServerResponse,
  TsServerEvent,
  CompletionEntry,
  QuickInfo,
  Diagnostic,
  DefinitionInfo,
  ReferenceEntry,
} from "./types"

interface StartServerParams {
  sessionId: string
  projectPath: string
  config: LSPConfig
}

export class LSPManager extends EventEmitter {
  private sessions = new Map<string, LSPSession & { process: ChildProcess }>()
  private outputBuffers = new Map<string, string>()

  /**
   * Start an LSP server for a project
   */
  async startServer(params: StartServerParams): Promise<void> {
    const { sessionId, projectPath, config } = params

    // Check for existing session
    const existing = this.sessions.get(sessionId)
    if (existing?.isAlive) {
      console.log(`[LSP] Session ${sessionId} already exists`)
      return
    }

    // Clean up dead session if exists
    if (existing) {
      this.sessions.delete(sessionId)
    }

    console.log(`[LSP] Starting server for session ${sessionId}, backend: ${config.backend}`)

    // Start the appropriate server
    if (config.backend === "tsgo") {
      await this.startTsgo(sessionId, projectPath, config)
    } else {
      await this.startTsserver(sessionId, projectPath, config)
    }
  }

  /**
   * Start tsserver (TypeScript's native language server)
   */
  private async startTsserver(
    sessionId: string,
    projectPath: string,
    config: LSPConfig
  ): Promise<void> {
    const tsserverPath = await this.findTsserver(projectPath)
    console.log(`[LSP] Using tsserver at: ${tsserverPath}`)

    const childProcess = spawn(
      "node",
      [tsserverPath, "--useInferredProjectPerProjectRoot"],
      {
        cwd: projectPath,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...globalThis.process.env,
          // Enable verbose logging in dev
          ...(app.isPackaged ? {} : { TSS_LOG: "-level verbose" }),
        },
      }
    )

    this.setupSession(sessionId, projectPath, config, childProcess)

    // Configure tsserver
    await this.sendRequest(sessionId, "configure", {
      hostInfo: "1code",
      preferences: {
        includeInlayParameterNameHints: "all",
        includeInlayVariableTypeHints: true,
        includeInlayPropertyDeclarationTypeHints: true,
        includeInlayFunctionLikeReturnTypeHints: true,
        includeInlayEnumMemberValueHints: true,
      },
    })

    // Set compiler options for the project
    await this.sendRequest(sessionId, "compilerOptionsForInferredProjects", {
      options: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        allowJs: true,
        checkJs: false,
      },
    })
  }

  /**
   * Start tsgo (TypeScript Go port - experimental)
   */
  private async startTsgo(
    sessionId: string,
    projectPath: string,
    config: LSPConfig
  ): Promise<void> {
    const tsgoPath = config.customPath || (await this.findTsgo())
    console.log(`[LSP] Using tsgo at: ${tsgoPath}`)

    const childProcess = spawn(tsgoPath, ["--stdio"], {
      cwd: projectPath,
      stdio: ["pipe", "pipe", "pipe"],
    })

    this.setupSession(sessionId, projectPath, config, childProcess)

    // tsgo uses standard LSP protocol - send initialize request
    // Note: Implementation depends on tsgo's actual LSP implementation
    // This is a placeholder for when tsgo is available
    console.log(`[LSP] tsgo session started (LSP protocol)`)
  }

  /**
   * Setup session with event handlers
   */
  private setupSession(
    sessionId: string,
    projectPath: string,
    config: LSPConfig,
    process: ChildProcess
  ): void {
    const session: LSPSession & { process: ChildProcess } = {
      id: sessionId,
      projectPath,
      config,
      isAlive: true,
      requestId: 0,
      pendingRequests: new Map(),
      process,
    }

    this.sessions.set(sessionId, session)
    this.outputBuffers.set(sessionId, "")

    // Handle stdout
    process.stdout?.on("data", (data: Buffer) => {
      this.handleOutput(sessionId, data.toString())
    })

    // Handle stderr
    process.stderr?.on("data", (data: Buffer) => {
      console.log(`[LSP:${sessionId}] stderr:`, data.toString())
    })

    // Handle process exit
    process.on("exit", (code) => {
      console.log(`[LSP:${sessionId}] Process exited with code ${code}`)
      session.isAlive = false
      this.emit(`exit:${sessionId}`, code)

      // Reject pending requests
      for (const [, pending] of session.pendingRequests) {
        pending.reject(new Error(`LSP server exited with code ${code}`))
      }
      session.pendingRequests.clear()
    })

    process.on("error", (error) => {
      console.error(`[LSP:${sessionId}] Process error:`, error)
      session.isAlive = false
      this.emit(`error:${sessionId}`, error)
    })
  }

  /**
   * Handle output from tsserver
   */
  private handleOutput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // Accumulate data in buffer
    let buffer = (this.outputBuffers.get(sessionId) || "") + data
    this.outputBuffers.set(sessionId, buffer)

    // tsserver outputs newline-delimited JSON
    // Each message starts with Content-Length header
    while (true) {
      // Look for Content-Length header
      const headerMatch = buffer.match(/^Content-Length: (\d+)\r?\n\r?\n/)
      if (!headerMatch) {
        // Try parsing without Content-Length (older tsserver)
        const lineEnd = buffer.indexOf("\n")
        if (lineEnd === -1) break

        const line = buffer.substring(0, lineEnd).trim()
        buffer = buffer.substring(lineEnd + 1)
        this.outputBuffers.set(sessionId, buffer)

        if (line) {
          try {
            const message = JSON.parse(line) as TsServerResponse | TsServerEvent
            this.handleMessage(sessionId, message)
          } catch {
            // Not valid JSON, skip
          }
        }
        continue
      }

      const contentLength = parseInt(headerMatch[1], 10)
      const headerLength = headerMatch[0].length
      const totalLength = headerLength + contentLength

      if (buffer.length < totalLength) {
        // Not enough data yet
        break
      }

      const content = buffer.substring(headerLength, totalLength)
      buffer = buffer.substring(totalLength)
      this.outputBuffers.set(sessionId, buffer)

      try {
        const message = JSON.parse(content) as TsServerResponse | TsServerEvent
        this.handleMessage(sessionId, message)
      } catch (error) {
        console.error(`[LSP:${sessionId}] Failed to parse message:`, error)
      }
    }
  }

  /**
   * Handle parsed message from tsserver
   */
  private handleMessage(
    sessionId: string,
    message: TsServerResponse | TsServerEvent
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (message.type === "response" && message.request_seq !== undefined) {
      // Response to a request
      const pending = session.pendingRequests.get(message.request_seq)
      if (pending) {
        session.pendingRequests.delete(message.request_seq)
        if (message.success) {
          pending.resolve(message.body)
        } else {
          pending.reject(new Error(message.message || "Request failed"))
        }
      }
    } else if (message.type === "event") {
      // Event from server
      const event = message as TsServerEvent
      this.emit(`event:${sessionId}`, event)

      // Handle specific events
      if (event.event === "semanticDiag" || event.event === "syntaxDiag") {
        this.emit(`diagnostics:${sessionId}`, event.body)
      }
    }
  }

  /**
   * Send a request to tsserver
   */
  async sendRequest(
    sessionId: string,
    command: string,
    args?: Record<string, any>
  ): Promise<any> {
    const session = this.sessions.get(sessionId)
    if (!session?.isAlive) {
      throw new Error(`Session ${sessionId} not found or not alive`)
    }

    const seq = ++session.requestId

    const request: TsServerRequest = {
      seq,
      type: "request",
      command,
      arguments: args,
    }

    return new Promise((resolve, reject) => {
      session.pendingRequests.set(seq, { resolve, reject, command })

      const json = JSON.stringify(request)
      session.process.stdin?.write(json + "\n")

      // Timeout after 30 seconds
      setTimeout(() => {
        if (session.pendingRequests.has(seq)) {
          session.pendingRequests.delete(seq)
          reject(new Error(`Request ${command} timed out`))
        }
      }, 30000)
    })
  }

  /**
   * Open a file in LSP server
   */
  async openFile(
    sessionId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    await this.sendRequest(sessionId, "open", {
      file: filePath,
      fileContent: content,
      scriptKindName: this.getScriptKind(filePath),
    })
  }

  /**
   * Update file content in LSP server
   * Uses updateOpen command to send full content update
   */
  async updateFile(
    sessionId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    // Use updateOpen to send the full file content
    // This is more reliable than reload which requires reading from disk
    await this.sendRequest(sessionId, "updateOpen", {
      openFiles: [
        {
          file: filePath,
          fileContent: content,
        },
      ],
    })
  }

  /**
   * Close a file in LSP server
   */
  async closeFile(sessionId: string, filePath: string): Promise<void> {
    await this.sendRequest(sessionId, "close", {
      file: filePath,
    })
  }

  /**
   * Get completions at position
   */
  async getCompletions(
    sessionId: string,
    filePath: string,
    line: number,
    offset: number
  ): Promise<CompletionEntry[]> {
    const result = await this.sendRequest(sessionId, "completions", {
      file: filePath,
      line,
      offset,
      includeExternalModuleExports: true,
      includeInsertTextCompletions: true,
      triggerKind: 1, // Invoked
    })
    return result || []
  }

  /**
   * Get completion entry details
   */
  async getCompletionDetails(
    sessionId: string,
    filePath: string,
    line: number,
    offset: number,
    entryNames: string[]
  ): Promise<any[]> {
    const result = await this.sendRequest(sessionId, "completionEntryDetails", {
      file: filePath,
      line,
      offset,
      entryNames,
    })
    return result || []
  }

  /**
   * Get quick info (hover) at position
   */
  async getQuickInfo(
    sessionId: string,
    filePath: string,
    line: number,
    offset: number
  ): Promise<QuickInfo | null> {
    try {
      return await this.sendRequest(sessionId, "quickinfo", {
        file: filePath,
        line,
        offset,
      })
    } catch {
      return null
    }
  }

  /**
   * Get diagnostics for file
   * Uses synchronous diagnostics commands for reliability
   */
  async getDiagnostics(
    sessionId: string,
    filePath: string
  ): Promise<Diagnostic[]> {
    try {
      // Use synchronous diagnostics commands - more reliable than geterr
      const [syntaxDiags, semanticDiags] = await Promise.all([
        this.sendRequest(sessionId, "syntaxDiagnosticsSync", {
          file: filePath,
        }).catch(() => []),
        this.sendRequest(sessionId, "semanticDiagnosticsSync", {
          file: filePath,
        }).catch(() => []),
      ])

      // Combine syntax and semantic diagnostics
      return [...(syntaxDiags || []), ...(semanticDiags || [])]
    } catch (error) {
      console.error(`[LSP:${sessionId}] getDiagnostics error:`, error)
      return []
    }
  }

  /**
   * Get definition at position
   */
  async getDefinition(
    sessionId: string,
    filePath: string,
    line: number,
    offset: number
  ): Promise<DefinitionInfo[]> {
    const result = await this.sendRequest(sessionId, "definition", {
      file: filePath,
      line,
      offset,
    })
    return result || []
  }

  /**
   * Get references at position
   */
  async getReferences(
    sessionId: string,
    filePath: string,
    line: number,
    offset: number
  ): Promise<ReferenceEntry[]> {
    const result = await this.sendRequest(sessionId, "references", {
      file: filePath,
      line,
      offset,
    })
    return result?.refs || []
  }

  /**
   * Get signature help at position
   */
  async getSignatureHelp(
    sessionId: string,
    filePath: string,
    line: number,
    offset: number
  ): Promise<any | null> {
    try {
      return await this.sendRequest(sessionId, "signatureHelp", {
        file: filePath,
        line,
        offset,
      })
    } catch {
      return null
    }
  }

  /**
   * Stop LSP server for session
   */
  async stopServer(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session?.isAlive) {
      // Try graceful shutdown
      try {
        await this.sendRequest(sessionId, "exit", {})
      } catch {
        // Force kill if graceful shutdown fails
        session.process.kill()
      }
      session.isAlive = false
    }
    this.sessions.delete(sessionId)
    this.outputBuffers.delete(sessionId)
  }

  /**
   * Find tsserver path
   */
  private async findTsserver(projectPath: string): Promise<string> {
    // Try local node_modules first
    const localPath = resolve(
      projectPath,
      "node_modules/typescript/lib/tsserver.js"
    )
    try {
      await access(localPath)
      return localPath
    } catch {
      // Fall back to app's bundled typescript
      const isDev = !app.isPackaged
      const appPath = app.getAppPath()

      if (isDev) {
        // In dev, use node_modules in project
        return resolve(appPath, "node_modules/typescript/lib/tsserver.js")
      } else {
        // In production, use bundled typescript
        return resolve(globalThis.process.resourcesPath!, "typescript/tsserver.js")
      }
    }
  }

  /**
   * Find tsgo path
   */
  private async findTsgo(): Promise<string> {
    // Check common locations
    const locations = [
      globalThis.process.env.TSGO_PATH,
      resolve(globalThis.process.env.HOME || "", ".tsgo/bin/tsgo"),
      "/usr/local/bin/tsgo",
      "/opt/homebrew/bin/tsgo",
    ].filter(Boolean) as string[]

    for (const loc of locations) {
      try {
        await access(loc)
        return loc
      } catch {
        continue
      }
    }

    throw new Error(
      "tsgo not found. Please install tsgo and set TSGO_PATH environment variable, " +
        "or provide the path in settings."
    )
  }

  /**
   * Get script kind from file extension
   */
  private getScriptKind(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase()
    switch (ext) {
      case "ts":
        return "TS"
      case "tsx":
        return "TSX"
      case "js":
        return "JS"
      case "jsx":
        return "JSX"
      default:
        return "TS"
    }
  }

  /**
   * Check if a session exists and is alive
   */
  isSessionAlive(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isAlive ?? false
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.entries())
      .filter(([, session]) => session.isAlive)
      .map(([id]) => id)
  }
}

// Singleton instance
export const lspManager = new LSPManager()
