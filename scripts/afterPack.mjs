#!/usr/bin/env node
/**
 * electron-builder afterPack hook
 * Creates symlinks for sharp's libvips dependency in the packaged app
 */

import { existsSync, symlinkSync, lstatSync, unlinkSync } from "fs"
import { join } from "path"

export default async function afterPack(context) {
  const appOutDir = context.appOutDir
  const platform = context.electronPlatformName
  const arch = context.arch === 3 ? "arm64" : "x64" // 3 = arm64 in electron-builder

  console.log(`[afterPack] Platform: ${platform}, Arch: ${arch}`)

  // Only handle macOS and Linux for now
  if (platform !== "darwin" && platform !== "linux") {
    console.log(`[afterPack] Skipping symlink creation for ${platform}`)
    return
  }

  const resourcesPath =
    platform === "darwin"
      ? join(appOutDir, "Hong.app", "Contents", "Resources")
      : join(appOutDir, "resources")

  const unpackedPath = join(resourcesPath, "app.asar.unpacked", "node_modules")

  // Check if unpacked directory exists
  if (!existsSync(unpackedPath)) {
    console.log(`[afterPack] No unpacked modules at ${unpackedPath}`)
    return
  }

  const platformArch = `${platform === "darwin" ? "darwin" : "linux"}-${arch}`

  // Source: top-level @img/sharp-libvips-*
  const sourceLibvipsDir = join(unpackedPath, "@img", `sharp-libvips-${platformArch}`)

  // Target: sharp/node_modules/@img/
  const targetImgDir = join(unpackedPath, "sharp", "node_modules", "@img")
  const targetLibvipsDir = join(targetImgDir, `sharp-libvips-${platformArch}`)

  if (!existsSync(sourceLibvipsDir)) {
    console.log(`[afterPack] Source libvips not found: ${sourceLibvipsDir}`)
    return
  }

  if (!existsSync(targetImgDir)) {
    console.log(`[afterPack] Target @img dir not found: ${targetImgDir}`)
    return
  }

  try {
    // Remove existing if present
    if (existsSync(targetLibvipsDir)) {
      const stat = lstatSync(targetLibvipsDir)
      if (stat.isSymbolicLink()) {
        unlinkSync(targetLibvipsDir)
      }
    }

    // Create symlink: sharp/node_modules/@img/sharp-libvips-* -> ../../../@img/sharp-libvips-*
    if (!existsSync(targetLibvipsDir)) {
      symlinkSync(`../../../@img/sharp-libvips-${platformArch}`, targetLibvipsDir)
      console.log(`[afterPack] Created symlink: ${targetLibvipsDir}`)
    }
  } catch (e) {
    console.error(`[afterPack] Failed to create symlink:`, e.message)
  }
}
