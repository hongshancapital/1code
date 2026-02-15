#!/usr/bin/env bun
/**
 * Fix "log is not defined" errors after migration.
 *
 * The migration script replaced untagged `console.xxx(...)` with `log.xxx(...)`,
 * but only declared tagged logger variables like `pluginsLog`, `mainLog`, etc.
 * This script finds files where `log.xxx` is used but `log` is not declared,
 * and replaces those calls with the first available tagged logger variable.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"

function walk(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (["node_modules", ".git", "dist", "out", "scripts"].includes(entry)) continue
      results.push(...walk(full))
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      results.push(full)
    }
  }
  return results
}

// Pattern: standalone `log.` calls (not part of xxxLog.)
const BARE_LOG_CALL = /(?<![a-zA-Z0-9_])log\.(info|warn|error|debug|verbose)\s*\(/g
// Pattern: createLogger declarations
const LOGGER_DECL = /const (\w+) = createLogger\(/g

let fixCount = 0

for (const file of walk("src")) {
  const content = readFileSync(file, "utf-8")

  // Skip files without bare log.xxx calls
  if (!BARE_LOG_CALL.test(content)) continue
  BARE_LOG_CALL.lastIndex = 0

  // Check if there's a `const log = createLogger(` declaration
  const hasBareDeclMatch = content.match(/const log = createLogger\(/)
  if (hasBareDeclMatch) continue // `log` is properly declared

  // Find all logger variable names
  const loggerVars: string[] = []
  let declMatch
  LOGGER_DECL.lastIndex = 0
  while ((declMatch = LOGGER_DECL.exec(content)) !== null) {
    loggerVars.push(declMatch[1])
  }

  if (loggerVars.length === 0) {
    // No createLogger at all — this file needs a `const log = createLogger(...)` added
    // But that's a different fix. Flag it.
    console.log(`⚠️  NO LOGGER: ${relative(".", file)} — needs manual createLogger import`)
    continue
  }

  // Use the first declared logger variable as replacement
  const replacement = loggerVars[0]

  let newContent = content
  BARE_LOG_CALL.lastIndex = 0
  // Replace all bare `log.xxx(` with `replacement.xxx(`
  // Be careful not to replace `xxxLog.xxx(` — only standalone `log.`
  newContent = newContent.replace(
    /(?<![a-zA-Z0-9_])log\.(info|warn|error|debug|verbose)\s*\(/g,
    `${replacement}.$1(`
  )

  if (newContent !== content) {
    writeFileSync(file, newContent, "utf-8")
    const count = (content.match(BARE_LOG_CALL) || []).length
    BARE_LOG_CALL.lastIndex = 0
    console.log(`✅ ${relative(".", file)}: log.xxx → ${replacement}.xxx`)
    fixCount++
  }
}

console.log(`\nFixed ${fixCount} files`)
