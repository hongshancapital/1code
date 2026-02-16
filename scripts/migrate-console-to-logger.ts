#!/usr/bin/env bun
/**
 * Console → Logger 迁移辅助脚本
 *
 * 扫描 src/ 下的 .ts/.tsx 文件，识别 console.log/warn/error/info/debug 调用，
 * 自动提取 [Tag] 前缀作为 scope 名，生成迁移后的代码。
 *
 * 用法:
 *   bun scripts/migrate-console-to-logger.ts                  # dry-run (只输出报告)
 *   bun scripts/migrate-console-to-logger.ts --apply           # 执行替换
 *   bun scripts/migrate-console-to-logger.ts --apply src/main/lib/claude  # 仅处理指定目录
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs"
import { join, relative, dirname } from "path"

const ROOT = join(import.meta.dir, "..")
const SRC_DIR = join(ROOT, "src")

const args = process.argv.slice(2)
const applyMode = args.includes("--apply")
const targetDir = args.find((a) => !a.startsWith("--"))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONSOLE_PATTERN =
  /console\.(log|warn|error|info|debug)\s*\(/g

const TAG_PATTERN = /^["'`]\[([A-Za-z][A-Za-z0-9:_-]*)\]\s*/

interface FileReport {
  path: string
  relativePath: string
  consoleCalls: number
  tags: Set<string>
  isMainProcess: boolean
}

function collectFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".git" || entry === "dist") continue
      files.push(...collectFiles(full))
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full)
    }
  }
  return files
}

function extractTags(content: string): Set<string> {
  const tags = new Set<string>()
  const lines = content.split("\n")
  for (const line of lines) {
    const match = line.match(CONSOLE_PATTERN)
    if (!match) continue
    // Find the first string argument after console.xxx(
    const callStart = line.indexOf("console.")
    const parenIdx = line.indexOf("(", callStart)
    if (parenIdx === -1) continue
    const afterParen = line.slice(parenIdx + 1).trim()
    const tagMatch = afterParen.match(TAG_PATTERN)
    if (tagMatch) {
      tags.add(tagMatch[1])
    }
  }
  return tags
}

function countConsoleCalls(content: string): number {
  return (content.match(CONSOLE_PATTERN) || []).length
}

// ---------------------------------------------------------------------------
// Scan phase
// ---------------------------------------------------------------------------

const scanDir = targetDir ? join(ROOT, targetDir) : SRC_DIR
const allFiles = collectFiles(scanDir)

const reports: FileReport[] = []
let totalCalls = 0
const globalTags = new Map<string, number>()

for (const file of allFiles) {
  const content = readFileSync(file, "utf-8")
  const count = countConsoleCalls(content)
  if (count === 0) continue

  const rel = relative(ROOT, file)
  const tags = extractTags(content)
  const isMain = rel.startsWith("src/main/")

  for (const tag of tags) {
    globalTags.set(tag, (globalTags.get(tag) || 0) + 1)
  }

  totalCalls += count
  reports.push({
    path: file,
    relativePath: rel,
    consoleCalls: count,
    tags,
    isMainProcess: isMain,
  })
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

reports.sort((a, b) => b.consoleCalls - a.consoleCalls)

console.log("=".repeat(60))
console.log("Console → Logger 迁移报告")
console.log("=".repeat(60))
console.log(`扫描目录: ${relative(ROOT, scanDir)}`)
console.log(`文件数: ${reports.length}`)
console.log(`总 console 调用: ${totalCalls}`)
console.log()

// Top files
console.log("--- 调用数最多的文件 (Top 20) ---")
for (const r of reports.slice(0, 20)) {
  const tags = r.tags.size > 0 ? ` [${[...r.tags].join(", ")}]` : ""
  const process = r.isMainProcess ? "main" : "renderer"
  console.log(`  ${String(r.consoleCalls).padStart(4)}  ${r.relativePath} (${process})${tags}`)
}
console.log()

// Tag distribution
console.log("--- 发现的 [Tag] 前缀 ---")
const sortedTags = [...globalTags.entries()].sort((a, b) => b[1] - a[1])
for (const [tag, count] of sortedTags) {
  console.log(`  ${String(count).padStart(4)}  ${tag}`)
}
console.log()

// Per-directory summary
const dirCounts = new Map<string, number>()
for (const r of reports) {
  const dir = dirname(r.relativePath)
  dirCounts.set(dir, (dirCounts.get(dir) || 0) + r.consoleCalls)
}
console.log("--- 按目录统计 ---")
const sortedDirs = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])
for (const [dir, count] of sortedDirs.slice(0, 15)) {
  console.log(`  ${String(count).padStart(4)}  ${dir}`)
}

// ---------------------------------------------------------------------------
// Apply phase (if --apply)
// ---------------------------------------------------------------------------

if (applyMode) {
  console.log()
  console.log("=".repeat(60))
  console.log("执行迁移...")
  console.log("=".repeat(60))

  let migratedFiles = 0
  let migratedCalls = 0

  for (const r of reports) {
    let content = readFileSync(r.path, "utf-8")
    const original = content

    // Determine import path for logger
    const isMain = r.isMainProcess
    const relToLogger = isMain
      ? relative(dirname(r.path), join(ROOT, "src/main/lib")).replace(/\\/g, "/")
      : relative(dirname(r.path), join(ROOT, "src/renderer/lib")).replace(/\\/g, "/")
    const importPath = relToLogger.startsWith(".") ? relToLogger : `./${relToLogger}`

    // Skip files that already import createLogger
    if (content.includes("createLogger")) continue

    // Collect unique tags in this file
    const fileTags = [...r.tags]

    // If no tags found, use a default scope from the filename
    const defaultScope = r.relativePath
      .split("/")
      .pop()!
      .replace(/\.(ts|tsx)$/, "")
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase()) // kebab to camelCase

    // Build import + logger declarations
    const loggerImport = `import { createLogger } from "${importPath}/logger"`
    const loggerDecls: string[] = []

    if (fileTags.length > 0) {
      for (const tag of fileTags) {
        const varName = tag.length <= 4
          ? `${tag.toLowerCase()}Log`
          : `${tag.charAt(0).toLowerCase()}${tag.slice(1)}Log`
        loggerDecls.push(`const ${varName} = createLogger("${tag}")`)
      }
    } else {
      loggerDecls.push(`const log = createLogger("${defaultScope}")`)
    }

    // Replace console calls
    const levelMap: Record<string, string> = {
      log: "info",
      warn: "warn",
      error: "error",
      info: "info",
      debug: "debug",
    }

    let modified = content
    const lines = modified.split("\n")
    const newLines: string[] = []
    let count = 0

    for (const line of lines) {
      let newLine = line

      // Match console.xxx( patterns
      const callMatch = newLine.match(/console\.(log|warn|error|info|debug)\s*\(/)
      if (callMatch) {
        const method = callMatch[1]
        const newMethod = levelMap[method] || "info"

        // Try to extract tag and determine which logger var to use
        const parenIdx = newLine.indexOf("(", newLine.indexOf(`console.${method}`))
        const afterParen = newLine.slice(parenIdx + 1).trim()
        const tagMatch = afterParen.match(TAG_PATTERN)

        let loggerVar = "log"
        if (tagMatch) {
          const tag = tagMatch[1]
          loggerVar = tag.length <= 4
            ? `${tag.toLowerCase()}Log`
            : `${tag.charAt(0).toLowerCase()}${tag.slice(1)}Log`

          // Remove the [Tag] prefix from the string argument
          const quoteChar = afterParen[0] // ' or " or `
          const tagFull = `${quoteChar}[${tag}] `
          const tagFullAlt = `${quoteChar}[${tag}]`
          newLine = newLine.replace(`console.${method}`, `${loggerVar}.${newMethod}`)
          // Remove tag prefix: "[Tag] message" → "message" or "[Tag]message" → "message"
          if (newLine.includes(tagFull)) {
            newLine = newLine.replace(tagFull, quoteChar)
          } else if (newLine.includes(tagFullAlt + " ")) {
            newLine = newLine.replace(tagFullAlt + " ", quoteChar)
          }
        } else {
          // No tag, use default logger
          newLine = newLine.replace(`console.${method}`, `${loggerVar}.${newMethod}`)
        }

        count++
      }

      newLines.push(newLine)
    }

    if (count === 0) continue

    modified = newLines.join("\n")

    // Add import and declarations at the top (after existing imports)
    const lastImportIdx = modified.lastIndexOf("\nimport ")
    if (lastImportIdx !== -1) {
      const nextNewline = modified.indexOf("\n", lastImportIdx + 1)
      const before = modified.slice(0, nextNewline + 1)
      const after = modified.slice(nextNewline + 1)
      modified = `${before}${loggerImport}\n\n${loggerDecls.join("\n")}\n\n${after}`
    }

    writeFileSync(r.path, modified, "utf-8")
    migratedFiles++
    migratedCalls += count
    console.log(`  ✅ ${r.relativePath}: ${count} calls migrated`)
  }

  console.log()
  console.log(`迁移完成: ${migratedFiles} 文件, ${migratedCalls} 调用`)
  console.log()
  console.log("⚠️  请手动检查以下事项:")
  console.log("   - 生成的 import 路径是否正确")
  console.log("   - logger 变量名是否与现有变量冲突")
  console.log("   - console.error 中带 Error 对象的调用是否需要保留 stack trace")
  console.log("   - 运行 bun run build 确认无类型错误")
} else {
  console.log()
  console.log("运行 --apply 执行实际替换:")
  console.log(`  bun scripts/migrate-console-to-logger.ts --apply`)
  console.log()
  console.log("仅处理指定目录:")
  console.log(`  bun scripts/migrate-console-to-logger.ts --apply src/main/lib/claude`)
}
