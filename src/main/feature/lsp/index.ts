/**
 * LSP Extension
 *
 * 将 Language Server Protocol 功能封装为 Extension。
 * 实现文件保留在 lib/lsp/，此处为轻量 wrapper 提供 router。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { lspRouter } from "../../lib/trpc/routers/lsp"

class LspExtension implements ExtensionModule {
  name = "lsp" as const
  description = "Language Server Protocol (completions, hover, diagnostics)"
  router = lspRouter
}

export const lspExtension = new LspExtension()
