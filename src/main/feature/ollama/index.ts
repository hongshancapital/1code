/**
 * Ollama Extension
 *
 * 将本地 Ollama 模型支持封装为 Extension。
 * 实现文件保留在 lib/ollama/，此处为轻量 wrapper 提供 router。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { ollamaRouter } from "../../lib/trpc/routers/ollama"

class OllamaExtension implements ExtensionModule {
  name = "ollama" as const
  description = "Local Ollama model support"
  router = ollamaRouter
}

export const ollamaExtension = new OllamaExtension()
