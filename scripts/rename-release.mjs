#!/usr/bin/env node

/**
 * Rename release files from "Hong" to "Hóng" and rebuild DMG with Applications link
 *
 * This script runs after packaging to:
 * 1. Rename Mac .app internal files (binary, Info.plist, Helpers)
 * 2. Rebuild DMG with Applications shortcut
 * 3. Rename ZIP and other release files
 * 4. Rename Windows installer
 * 5. Update manifest files
 *
 * Note: We use "Hong" (without accent) during build because Electron
 * crashes on startup when the app bundle name contains Unicode characters.
 */

import {
  readdirSync,
  renameSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  symlinkSync,
  statSync,
} from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const releaseDir = join(__dirname, "../release")
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
)
const version = packageJson.version

if (!existsSync(releaseDir)) {
  console.error("Release directory not found:", releaseDir)
  process.exit(1)
}

console.log("=".repeat(60))
console.log("Renaming release files from 'Hong' to 'Hóng'")
console.log("=".repeat(60))
console.log()

/**
 * Recursively copy a directory
 */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else if (entry.isSymbolicLink()) {
      // Preserve symlinks
      const linkTarget = readFileSync(srcPath)
      symlinkSync(linkTarget, destPath)
    } else {
      copyFileSync(srcPath, destPath)
      // Preserve executable permission
      const stat = statSync(srcPath)
      if (stat.mode & 0o111) {
        execSync(`chmod +x "${destPath}"`)
      }
    }
  }
}

/**
 * Update Info.plist files - replace Hong with Hóng
 */
function updatePlist(plistPath) {
  if (!existsSync(plistPath)) return false
  let content = readFileSync(plistPath, "utf-8")
  if (content.includes(">Hong<")) {
    content = content.replace(/>Hong</g, ">Hóng<")
    writeFileSync(plistPath, content)
    return true
  }
  return false
}

/**
 * Rename Mac app internals
 */
function renameMacApp(appPath) {
  if (!existsSync(appPath)) {
    console.log("  Mac app not found, skipping Mac rename")
    return false
  }

  console.log("[Mac] Renaming app internals...")

  // 1. Rename main binary
  const mainBinaryOld = join(appPath, "Contents/MacOS/Hong")
  const mainBinaryNew = join(appPath, "Contents/MacOS/Hóng")
  if (existsSync(mainBinaryOld)) {
    renameSync(mainBinaryOld, mainBinaryNew)
    console.log("  Renamed main binary: Hong -> Hóng")
  }

  // 2. Update main Info.plist
  const mainPlist = join(appPath, "Contents/Info.plist")
  if (updatePlist(mainPlist)) {
    console.log("  Updated main Info.plist")
  }

  // 3. Rename Helper apps
  const frameworksDir = join(appPath, "Contents/Frameworks")
  if (existsSync(frameworksDir)) {
    const helpers = [
      "Hong Helper.app",
      "Hong Helper (GPU).app",
      "Hong Helper (Plugin).app",
      "Hong Helper (Renderer).app",
    ]

    for (const helper of helpers) {
      const helperPath = join(frameworksDir, helper)
      if (existsSync(helperPath)) {
        const newHelperName = helper.replace(/Hong/g, "Hóng")
        const newHelperPath = join(frameworksDir, newHelperName)

        // Rename binary inside helper
        const binName = helper.replace(".app", "")
        const newBinName = newHelperName.replace(".app", "")
        const binOld = join(helperPath, "Contents/MacOS", binName)
        const binNew = join(helperPath, "Contents/MacOS", newBinName)
        if (existsSync(binOld)) {
          renameSync(binOld, binNew)
        }

        // Update helper Info.plist
        updatePlist(join(helperPath, "Contents/Info.plist"))

        // Rename helper folder
        renameSync(helperPath, newHelperPath)
        console.log(`  Renamed helper: ${helper} -> ${newHelperName}`)
      }
    }
  }

  return true
}

/**
 * Create DMG with Applications link
 */
function createDmgWithApplicationsLink(appPath, dmgPath) {
  console.log("[Mac] Creating DMG with Applications link...")

  const tmpDir = "/tmp/hong-dmg-" + Date.now()

  try {
    // Create temp directory
    mkdirSync(tmpDir, { recursive: true })

    // Copy app to temp directory
    const appName = "Hóng.app"
    const tmpAppPath = join(tmpDir, appName)
    console.log("  Copying app to temp directory...")
    execSync(`cp -R "${appPath}" "${tmpAppPath}"`)

    // Create Applications symlink
    const applicationsLink = join(tmpDir, "Applications")
    symlinkSync("/Applications", applicationsLink)
    console.log("  Created Applications symlink")

    // Remove old DMG if exists
    if (existsSync(dmgPath)) {
      rmSync(dmgPath)
    }

    // Create DMG
    console.log("  Creating DMG (this may take a minute)...")
    execSync(
      `hdiutil create -volname "Hóng" -srcfolder "${tmpDir}" -ov -format UDZO "${dmgPath}"`,
      { stdio: "inherit" }
    )

    console.log(`  Created: ${dmgPath}`)
    return true
  } catch (err) {
    console.error("  Failed to create DMG:", err.message)
    return false
  } finally {
    // Cleanup
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }
}

/**
 * Rename files in release directory
 */
function renameReleaseFiles() {
  console.log("[Files] Renaming release files...")

  const files = readdirSync(releaseDir)
  let renamed = 0

  for (const file of files) {
    // Skip directories and files already renamed
    const filePath = join(releaseDir, file)
    if (statSync(filePath).isDirectory()) continue
    if (!file.includes("Hong") || file.includes("Hóng")) continue

    const newName = file.replace(/Hong/g, "Hóng")
    const newPath = join(releaseDir, newName)

    try {
      renameSync(filePath, newPath)
      console.log(`  ${file} -> ${newName}`)
      renamed++
    } catch (err) {
      console.error(`  Failed to rename ${file}:`, err.message)
    }
  }

  return renamed
}

/**
 * Update manifest files
 */
function updateManifests() {
  console.log("[Manifests] Updating manifest files...")

  const manifests = ["latest-mac.yml", "latest-mac-x64.yml", "latest.yml"]

  for (const manifest of manifests) {
    const manifestPath = join(releaseDir, manifest)
    if (existsSync(manifestPath)) {
      let content = readFileSync(manifestPath, "utf-8")
      if (content.includes("Hong") && !content.includes("Hóng")) {
        content = content.replace(/Hong/g, "Hóng")
        writeFileSync(manifestPath, content)
        console.log(`  Updated ${manifest}`)
      }
    }
  }
}

// ============================================================
// Main execution
// ============================================================

// 1. Process Mac app
const macArm64Dir = join(releaseDir, "mac-arm64")
const macAppPath = join(macArm64Dir, "Hong.app")
const macAppPathNew = join(macArm64Dir, "Hóng.app")

if (existsSync(macAppPath)) {
  // Rename app internals first
  renameMacApp(macAppPath)

  // Rename the .app folder itself
  renameSync(macAppPath, macAppPathNew)
  console.log("  Renamed app folder: Hong.app -> Hóng.app")

  // Delete old DMG created by electron-builder (no Applications link)
  const oldDmgPattern = new RegExp(`Hong-${version}.*\\.dmg$`)
  const files = readdirSync(releaseDir)
  for (const file of files) {
    if (oldDmgPattern.test(file)) {
      const oldDmgPath = join(releaseDir, file)
      rmSync(oldDmgPath)
      console.log(`  Deleted old DMG: ${file}`)
    }
  }

  // Create new DMG with Applications link
  const newDmgPath = join(releaseDir, `Hóng-${version}-arm64.dmg`)
  createDmgWithApplicationsLink(macAppPathNew, newDmgPath)

  console.log()
}

// 2. Rename other release files (ZIP, blockmap, Windows exe, etc.)
renameReleaseFiles()
console.log()

// 3. Update manifests
updateManifests()
console.log()

// 4. Summary
console.log("=".repeat(60))
console.log("Release rename complete!")
console.log()
console.log("Release files:")
const finalFiles = readdirSync(releaseDir).filter(
  (f) => !statSync(join(releaseDir, f)).isDirectory() && !f.startsWith(".")
)
for (const file of finalFiles) {
  const size = statSync(join(releaseDir, file)).size
  const sizeMB = (size / 1024 / 1024).toFixed(1)
  console.log(`  ${file} (${sizeMB} MB)`)
}
console.log("=".repeat(60))
