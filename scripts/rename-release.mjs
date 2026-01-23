#!/usr/bin/env node

/**
 * Rename release files from "Hong" to "Hóng" and rebuild DMG with Applications link
 *
 * This script runs after packaging to:
 * 1. Rebuild DMG with Applications shortcut (keeping app internal name as Hong)
 * 2. Rename release files (DMG, ZIP, EXE) to use "Hóng"
 * 3. Update manifest files
 *
 * Note: We keep "Hong" (without accent) for app internals because Electron/V8
 * crashes on startup when the app bundle name contains Unicode characters.
 * Only the external file names use "Hóng".
 */

import {
  readdirSync,
  renameSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
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
console.log("(App internals remain as 'Hong' to avoid V8 crash)")
console.log("=".repeat(60))
console.log()

/**
 * Create DMG with Applications link
 * App stays as Hong.app inside, but DMG and volume name use Hóng
 */
function createDmgWithApplicationsLink(appPath, dmgPath) {
  console.log("[Mac] Creating DMG with Applications link...")

  const tmpDir = "/tmp/hong-dmg-" + Date.now()

  try {
    // Create temp directory
    mkdirSync(tmpDir, { recursive: true })

    // Copy app to temp directory (keep as Hong.app)
    const tmpAppPath = join(tmpDir, "Hong.app")
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

    // Create DMG with Hóng as volume name
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
 * Rename files in release directory (only filenames, not app internals)
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

// 1. Process Mac app - create DMG with Applications link
const macArm64Dir = join(releaseDir, "mac-arm64")
const macAppPath = join(macArm64Dir, "Hong.app")

if (existsSync(macAppPath)) {
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

  // Create new DMG with Applications link (filename uses Hóng)
  const newDmgPath = join(releaseDir, `Hóng-${version}-arm64.dmg`)
  createDmgWithApplicationsLink(macAppPath, newDmgPath)

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
