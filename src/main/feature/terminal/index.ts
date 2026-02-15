/**
 * Terminal Extension
 *
 * PTY 终端管理。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { terminalRouter } from "./router"

class TerminalExtension implements ExtensionModule {
  name = "terminal" as const
  description = "PTY terminal management"
  router = terminalRouter
}

export const terminalExtension = new TerminalExtension()
