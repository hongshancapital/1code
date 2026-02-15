#!/usr/bin/env bun
/**
 * Fix broken multi-line imports caused by the migration script.
 * The script inserted `import { createLogger }` and `const xxxLog = ...` lines
 * in the middle of multi-line import statements.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"

function walk(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (["node_modules", ".git", "dist", "out"].includes(entry)) continue
      results.push(...walk(full))
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      results.push(full)
    }
  }
  return results
}

let fixCount = 0

for (const file of walk("src")) {
  let content = readFileSync(file, "utf-8")
  const original = content

  // Detect the pattern:
  // import [type] {
  // import { createLogger } from "..."
  //
  // const xxxLog = createLogger("...")
  // [const yyyLog = createLogger("...")]
  //
  //   actualImportItems,
  //   ...
  // } from "..."
  //
  // The fix: move the createLogger import + const declarations AFTER the broken import block

  const pattern = /(import\s+(?:type\s+)?\{)\s*\nimport \{ createLogger \} from ([^\n]+)\n\n((?:const \w+ = createLogger\([^\n]+\)\n)+)\n([\s\S]*?\} from [^\n]+)/g

  let match
  while ((match = pattern.exec(content)) !== null) {
    const fullMatch = match[0]
    const importStart = match[1] // "import type {" or "import {"
    const loggerPath = match[2]  // e.g., "../logger"
    const constDecls = match[3]  // const lines
    const restOfImport = match[4] // "  items,\n} from ..."

    // Reconstruct: original multi-line import intact, then logger stuff after
    const fixed = `${importStart}\n${restOfImport}\nimport { createLogger } from ${loggerPath}\n\n${constDecls}`
    content = content.replace(fullMatch, fixed)
    fixCount++
    console.log(`Fixed: ${relative(".", file)}`)
  }

  if (content !== original) {
    writeFileSync(file, content, "utf-8")
  }
}

console.log(`\nTotal fixes: ${fixCount}`)
