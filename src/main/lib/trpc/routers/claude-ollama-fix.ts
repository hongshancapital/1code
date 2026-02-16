/**
 * Ollama 模型工具参数修复
 * 本地模型经常使用略有不同的参数名，这里统一修正
 */

import { createLogger } from "../../logger"

const log = createLogger("Ollama")

/**
 * 修复 Ollama 模型常见的工具参数命名错误
 * 直接修改 toolInput 对象（in-place mutation）
 */
export function fixOllamaToolParameters(
  toolName: string,
  toolInput: Record<string, unknown>,
): void {
  // Read/Write/Edit: "file" -> "file_path"
  if (
    (toolName === "Read" || toolName === "Write" || toolName === "Edit") &&
    toolInput.file &&
    !toolInput.file_path
  ) {
    toolInput.file_path = toolInput.file
    delete toolInput.file
    log.info(`Fixed ${toolName} tool: file -> file_path`)
  }

  // Glob: "directory"/"dir" -> "path"
  if (toolName === "Glob") {
    if (toolInput.directory && !toolInput.path) {
      toolInput.path = toolInput.directory
      delete toolInput.directory
      log.info("Fixed Glob tool: directory -> path")
    }
    if (toolInput.dir && !toolInput.path) {
      toolInput.path = toolInput.dir
      delete toolInput.dir
      log.info("Fixed Glob tool: dir -> path")
    }
  }

  // Grep: "query" -> "pattern", "directory" -> "path"
  if (toolName === "Grep") {
    if (toolInput.query && !toolInput.pattern) {
      toolInput.pattern = toolInput.query
      delete toolInput.query
      log.info("Fixed Grep tool: query -> pattern")
    }
    if (toolInput.directory && !toolInput.path) {
      toolInput.path = toolInput.directory
      delete toolInput.directory
      log.info("Fixed Grep tool: directory -> path")
    }
  }

  // Bash: "cmd" -> "command"
  if (toolName === "Bash" && toolInput.cmd && !toolInput.command) {
    toolInput.command = toolInput.cmd
    delete toolInput.cmd
    log.info("Fixed Bash tool: cmd -> command")
  }
}
