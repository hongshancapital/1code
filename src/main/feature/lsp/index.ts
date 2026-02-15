/**
 * LSP Extension
 *
 * Language Server Protocol（补全、悬停、诊断）。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { lspRouter } from "./router"

class LspExtension implements ExtensionModule {
  name = "lsp" as const
  description = "Language Server Protocol (completions, hover, diagnostics)"
  router = lspRouter
}

export const lspExtension = new LspExtension()
