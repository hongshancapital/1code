/**
 * Terminal Extension
 *
 * 将 PTY 终端管理功能封装为 Extension。
 * 实现文件保留在 lib/terminal/，此处为轻量 wrapper 提供 router。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { terminalRouter } from "../../lib/trpc/routers/terminal"

class TerminalExtension implements ExtensionModule {
  name = "terminal" as const
  description = "PTY terminal management"
  router = terminalRouter
}

export const terminalExtension = new TerminalExtension()
