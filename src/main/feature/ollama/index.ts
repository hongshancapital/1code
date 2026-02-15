/**
 * Ollama Extension
 *
 * 本地 Ollama 模型支持。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { ollamaRouter } from "./router"

class OllamaExtension implements ExtensionModule {
  name = "ollama" as const
  description = "Local Ollama model support"
  router = ollamaRouter
}

export const ollamaExtension = new OllamaExtension()
