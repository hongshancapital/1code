#!/usr/bin/env node
/**
 * postinstall script
 * - Rebuilds native modules for Electron
 * - Fixes sharp's libvips dependency (bun hoisting workaround)
 */

import { execSync } from "child_process"
import { existsSync, symlinkSync, unlinkSync, mkdirSync, lstatSync, cpSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, "..")

// Skip on Vercel or Windows
if (process.env.VERCEL || process.platform === "win32") {
  console.log("Skipping postinstall on Vercel/Windows")
  process.exit(0)
}

// 1. Electron rebuild for native modules
console.log("Rebuilding native modules for Electron...")
try {
  execSync("npx electron-rebuild -f -w better-sqlite3,node-pty", {
    stdio: "inherit",
    cwd: rootDir,
  })
} catch (e) {
  console.error("electron-rebuild failed:", e.message)
}

// 2. Fix sharp libvips location (bun hoisting issue)
// sharp-darwin-arm64.node has @rpath set to look for libvips in specific relative paths
// Bun hoists @img/sharp-libvips-* to top level, but sharp's nested @img/sharp-darwin-arm64
// expects it at: @loader_path/../../sharp-libvips-darwin-arm64/lib/
console.log("Fixing sharp libvips location...")

const platform = process.platform
const arch = process.arch

const platformMap = { darwin: "darwin", linux: "linux", win32: "win32" }
const archMap = { arm64: "arm64", x64: "x64" }

const osPlatform = platformMap[platform]
const osArch = archMap[arch]

if (osPlatform && osArch) {
  // Source: top-level @img/sharp-libvips-*
  const sourceLibvipsDir = join(
    rootDir,
    "node_modules/@img",
    `sharp-libvips-${osPlatform}-${osArch}`
  )

  if (!existsSync(sourceLibvipsDir)) {
    console.error(`libvips source not found at: ${sourceLibvipsDir}`)
    process.exit(1)
  }

  // Target location that matches @rpath: @loader_path/../../sharp-libvips-darwin-arm64/lib
  // From: node_modules/sharp/node_modules/@img/sharp-darwin-arm64/lib/
  // ../../sharp-libvips-darwin-arm64 = node_modules/sharp/node_modules/@img/sharp-libvips-darwin-arm64
  const targetLibvipsDir = join(
    rootDir,
    "node_modules/sharp/node_modules/@img",
    `sharp-libvips-${osPlatform}-${osArch}`
  )

  const sharpNestedImgDir = join(rootDir, "node_modules/sharp/node_modules/@img")

  if (existsSync(sharpNestedImgDir)) {
    try {
      // Remove existing target if it exists
      if (existsSync(targetLibvipsDir)) {
        const stat = lstatSync(targetLibvipsDir)
        if (stat.isSymbolicLink()) {
          unlinkSync(targetLibvipsDir)
        }
      }

      // Create symlink to top-level libvips
      // node_modules/sharp/node_modules/@img/sharp-libvips-darwin-arm64 -> ../../../@img/sharp-libvips-darwin-arm64
      // Path: from sharp/node_modules/@img/ go up 3 levels to node_modules/, then into @img/
      if (!existsSync(targetLibvipsDir)) {
        symlinkSync(
          `../../../@img/sharp-libvips-${osPlatform}-${osArch}`,
          targetLibvipsDir
        )
        console.log(`Created symlink: ${targetLibvipsDir}`)
      }
    } catch (e) {
      console.error(`Failed to create libvips symlink:`, e.message)
    }
  }

  // Also fix top-level @img directory for consistency
  const topLevelSharpDir = join(rootDir, "node_modules/@img", `sharp-${osPlatform}-${osArch}`, "lib")
  const libvipsName =
    platform === "darwin"
      ? "libvips-cpp.8.17.3.dylib"
      : platform === "linux"
        ? "libvips-cpp.so.8.17.3"
        : null

  if (libvipsName && existsSync(topLevelSharpDir)) {
    const symlinkPath = join(topLevelSharpDir, libvipsName)
    const relativePath = `../../sharp-libvips-${osPlatform}-${osArch}/lib/${libvipsName}`

    if (!existsSync(symlinkPath)) {
      try {
        symlinkSync(relativePath, symlinkPath)
        console.log(`Created symlink: ${symlinkPath}`)
      } catch (e) {
        console.error(`Failed to create top-level libvips symlink:`, e.message)
      }
    }
  }
}

console.log("postinstall complete")
