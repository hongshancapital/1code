#!/usr/bin/env node
/**
 * Downloads whisper-cli and ffmpeg binaries for local speech-to-text.
 *
 * Sources:
 * - whisper-cli: Homebrew bottles (macOS/Linux), GitHub releases (Windows)
 * - ffmpeg: Homebrew bottles (macOS/Linux), GitHub releases (Windows)
 *
 * Usage:
 *   node scripts/download-whisper-binary.mjs           # Download for current platform
 *   node scripts/download-whisper-binary.mjs --all     # Download all platforms
 */

import fs from "node:fs"
import path from "node:path"
import https from "node:https"
import { execSync } from "node:child_process"
import { createGunzip } from "node:zlib"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, "..")
const WHISPER_DIR = path.join(ROOT_DIR, "resources", "whisper")

// Homebrew API
const HOMEBREW_API = "https://formulae.brew.sh/api/formula"
const GHCR_BASE = "https://ghcr.io"

// GitHub releases
const WHISPER_GITHUB_RELEASE = "https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest"

// ffmpeg-static binary URLs (from npm package's CDN)
// These URLs are extracted from ffmpeg-static package's install script
const FFMPEG_STATIC_BASE = "https://github.com/eugeneware/ffmpeg-static/releases/download"
const FFMPEG_STATIC_VERSION = "b6.1.1" // Check https://github.com/eugeneware/ffmpeg-static/releases

const FFMPEG_STATIC_BINARIES = {
  "darwin-arm64": `${FFMPEG_STATIC_BASE}/${FFMPEG_STATIC_VERSION}/ffmpeg-darwin-arm64`,
  "darwin-x64": `${FFMPEG_STATIC_BASE}/${FFMPEG_STATIC_VERSION}/ffmpeg-darwin-x64`,
  "linux-x64": `${FFMPEG_STATIC_BASE}/${FFMPEG_STATIC_VERSION}/ffmpeg-linux-x64`,
  "linux-arm64": `${FFMPEG_STATIC_BASE}/${FFMPEG_STATIC_VERSION}/ffmpeg-linux-arm64`,
  "win32-x64": `${FFMPEG_STATIC_BASE}/${FFMPEG_STATIC_VERSION}/ffmpeg-win32-x64.exe`,
}

// Platform configurations
const PLATFORMS = {
  "darwin-arm64": {
    whisperBottle: "arm64_sequoia",
  },
  "darwin-x64": {
    whisperBottle: "sonoma",
  },
  "linux-x64": {
    whisperBottle: "x86_64_linux",
  },
  "linux-arm64": {
    whisperBottle: "arm64_linux",
  },
  "win32-x64": {
    whisperGitHub: true,
  },
}

/**
 * Fetch JSON from URL
 */
async function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        "User-Agent": "hong-desktop/1.0",
        ...headers,
      },
    }

    https
      .get(options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return fetchJson(res.headers.location, headers).then(resolve).catch(reject)
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error(`Invalid JSON from ${url}`))
          }
        })
        res.on("error", reject)
      })
      .on("error", reject)
  })
}

/**
 * Download file using curl (more reliable for redirects and auth)
 */
function downloadFile(url, destPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H "${k}: ${v}"`)
      .join(" ")

    const cmd = `curl -L ${headerArgs} "${url}" -o "${destPath}" --progress-bar --fail --max-time 300`

    try {
      execSync(cmd, { stdio: "inherit" })
      resolve()
    } catch (error) {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      reject(new Error(`Download failed: ${error.message}`))
    }
  })
}

/**
 * Get GHCR anonymous token
 */
async function getGhcrToken(repo) {
  const url = `${GHCR_BASE}/token?scope=repository:${repo}:pull`
  const data = await fetchJson(url)
  return data.token
}

/**
 * Download and extract Homebrew bottle
 */
async function downloadHomebrewBottle(formula, bottleName, targetDir, binaryName) {
  console.log(`  Fetching ${formula} formula info...`)

  // Get formula info
  const formulaInfo = await fetchJson(`${HOMEBREW_API}/${formula}.json`)
  const version = formulaInfo.versions.stable
  const bottleInfo = formulaInfo.bottle?.stable?.files?.[bottleName]

  if (!bottleInfo) {
    throw new Error(`No bottle found for ${formula} on ${bottleName}`)
  }

  console.log(`  Version: ${version}`)
  console.log(`  Bottle: ${bottleName}`)

  // Get GHCR token
  const token = await getGhcrToken(`homebrew/core/${formula}`)

  // Download bottle
  const tempTar = path.join(targetDir, `${formula}-bottle.tar.gz`)
  console.log(`  Downloading bottle...`)

  await downloadFile(bottleInfo.url, tempTar, {
    Authorization: `Bearer ${token}`,
  })

  // Extract from bottle
  console.log(`  Extracting ${binaryName}...`)

  const extractDir = path.join(targetDir, `${formula}-extract`)
  fs.mkdirSync(extractDir, { recursive: true })

  try {
    execSync(`tar -xzf "${tempTar}" -C "${extractDir}"`, { stdio: "pipe" })

    // For whisper-cpp, we need to copy binary + all dylibs
    if (formula === "whisper-cpp") {
      // Find libexec directory (has self-contained binaries)
      const libexecDir = findDir(extractDir, "libexec")
      if (!libexecDir) {
        throw new Error("libexec directory not found in whisper-cpp bottle")
      }

      // Copy binary from libexec/bin
      const binPath = path.join(libexecDir, "bin", binaryName)
      if (!fs.existsSync(binPath)) {
        throw new Error(`Binary ${binaryName} not found in libexec/bin`)
      }
      const targetBinPath = path.join(targetDir, binaryName)
      fs.copyFileSync(binPath, targetBinPath)
      fs.chmodSync(targetBinPath, 0o755)
      console.log(`  Saved: ${targetBinPath}`)

      // Copy all dylibs from libexec/lib to lib/
      const libexecLibDir = path.join(libexecDir, "lib")
      if (fs.existsSync(libexecLibDir)) {
        const libDir = path.join(targetDir, "lib")
        fs.mkdirSync(libDir, { recursive: true })
        const libs = fs.readdirSync(libexecLibDir)
        for (const lib of libs) {
          const srcLib = path.join(libexecLibDir, lib)
          const destLib = path.join(libDir, lib)
          if (fs.statSync(srcLib).isFile()) {
            fs.copyFileSync(srcLib, destLib)
            console.log(`  Saved: ${destLib}`)
          }
        }
      }

      // Copy Metal shader if exists
      const metalFile = findFile(extractDir, "ggml-metal.metal")
      if (metalFile) {
        const destMetal = path.join(targetDir, "lib", "ggml-metal.metal")
        fs.copyFileSync(metalFile, destMetal)
        console.log(`  Saved: ${destMetal}`)
      }

      return { version, path: targetBinPath }
    }

    // For ffmpeg, just copy the binary
    const binPath = findBinary(extractDir, binaryName)
    if (!binPath) {
      throw new Error(`Binary ${binaryName} not found in bottle`)
    }

    const targetPath = path.join(targetDir, binaryName)
    fs.copyFileSync(binPath, targetPath)
    fs.chmodSync(targetPath, 0o755)

    console.log(`  Saved: ${targetPath}`)
    return { version, path: targetPath }
  } finally {
    // Cleanup
    fs.rmSync(tempTar, { force: true })
    fs.rmSync(extractDir, { recursive: true, force: true })
  }
}

/**
 * Find directory by name (recursive)
 */
function findDir(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === name) return fullPath
      const found = findDir(fullPath, name)
      if (found) return found
    }
  }
  return null
}

/**
 * Find file by name (recursive)
 */
function findFile(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(fullPath, name)
      if (found) return found
    } else if (entry.name === name) {
      return fullPath
    }
  }
  return null
}

/**
 * Find binary in extracted directory (recursive)
 */
function findBinary(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findBinary(fullPath, name)
      if (found) return found
    } else if (entry.name === name) {
      return fullPath
    }
  }

  return null
}

/**
 * Download whisper binary from GitHub releases (Windows)
 */
async function downloadWhisperFromGitHub(targetDir) {
  console.log(`  Fetching latest whisper.cpp release...`)

  const releaseInfo = await fetchJson(WHISPER_GITHUB_RELEASE)
  const version = releaseInfo.tag_name

  // Find whisper-bin-x64.zip asset
  const asset = releaseInfo.assets.find((a) => a.name === "whisper-bin-x64.zip")
  if (!asset) {
    throw new Error("whisper-bin-x64.zip not found in release")
  }

  console.log(`  Version: ${version}`)
  console.log(`  Asset: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`)

  const tempZip = path.join(targetDir, "whisper-bin.zip")
  await downloadFile(asset.browser_download_url, tempZip)

  // Extract
  console.log(`  Extracting...`)
  const extractDir = path.join(targetDir, "whisper-extract")
  fs.mkdirSync(extractDir, { recursive: true })

  try {
    execSync(`unzip -q "${tempZip}" -d "${extractDir}"`, { stdio: "pipe" })

    // Find whisper-cli.exe (might be named main.exe or whisper.exe)
    let binaryPath = findBinary(extractDir, "whisper-cli.exe")
    if (!binaryPath) binaryPath = findBinary(extractDir, "main.exe")
    if (!binaryPath) binaryPath = findBinary(extractDir, "whisper.exe")

    if (!binaryPath) {
      // List what we found for debugging
      console.log("  Available files:", fs.readdirSync(extractDir))
      throw new Error("whisper executable not found in zip")
    }

    const targetPath = path.join(targetDir, "whisper-cli.exe")
    fs.copyFileSync(binaryPath, targetPath)

    console.log(`  Saved: ${targetPath}`)
    return { version, path: targetPath }
  } finally {
    fs.rmSync(tempZip, { force: true })
    fs.rmSync(extractDir, { recursive: true, force: true })
  }
}

/**
 * Download ffmpeg static binary
 */
async function downloadFfmpegStatic(platformKey, targetDir) {
  const url = FFMPEG_STATIC_BINARIES[platformKey]
  if (!url) {
    throw new Error(`No ffmpeg-static binary for ${platformKey}`)
  }

  const isWindows = platformKey.startsWith("win32")
  const binaryName = isWindows ? "ffmpeg.exe" : "ffmpeg"
  const targetPath = path.join(targetDir, binaryName)

  console.log(`  Downloading ffmpeg-static...`)
  await downloadFile(url, targetPath)

  if (!isWindows) {
    fs.chmodSync(targetPath, 0o755)
  }

  console.log(`  Saved: ${targetPath}`)
  return { path: targetPath }
}

/**
 * Download binaries for a platform
 */
async function downloadPlatform(platformKey) {
  const config = PLATFORMS[platformKey]
  if (!config) {
    console.error(`Unknown platform: ${platformKey}`)
    return false
  }

  const targetDir = path.join(WHISPER_DIR, platformKey)
  fs.mkdirSync(targetDir, { recursive: true })

  console.log(`\n📦 Downloading for ${platformKey}`)
  console.log("─".repeat(40))

  const isWindows = platformKey.startsWith("win32")
  let whisperVersion = "unknown"

  try {
    // Download whisper-cli
    console.log("\n[1/2] whisper-cli")
    if (isWindows) {
      const result = await downloadWhisperFromGitHub(targetDir)
      whisperVersion = result.version
    } else {
      const result = await downloadHomebrewBottle(
        "whisper-cpp",
        config.whisperBottle,
        targetDir,
        "whisper-cli"
      )
      whisperVersion = result.version
    }

    // Download ffmpeg (static binary)
    console.log("\n[2/2] ffmpeg")
    await downloadFfmpegStatic(platformKey, targetDir)

    return { success: true, whisperVersion }
  } catch (error) {
    console.error(`\n  ❌ Error: ${error.message}`)
    return { success: false }
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2)
  const downloadAll = args.includes("--all")

  console.log("Whisper Binary Downloader")
  console.log("=========================")
  console.log("Downloads whisper-cli and ffmpeg for local speech-to-text\n")

  // Determine platforms
  let platformsToDownload
  if (downloadAll) {
    platformsToDownload = Object.keys(PLATFORMS)
  } else {
    const currentPlatform = `${process.platform}-${process.arch}`
    if (!PLATFORMS[currentPlatform]) {
      console.error(`Unsupported platform: ${currentPlatform}`)
      console.log(`Supported: ${Object.keys(PLATFORMS).join(", ")}`)
      process.exit(1)
    }
    platformsToDownload = [currentPlatform]
  }

  console.log(`Platforms: ${platformsToDownload.join(", ")}`)

  // Create directory
  fs.mkdirSync(WHISPER_DIR, { recursive: true })

  // Download each platform
  let allSuccess = true
  let whisperVersion = "unknown"

  for (const platform of platformsToDownload) {
    const result = await downloadPlatform(platform)
    if (!result.success) {
      allSuccess = false
    } else if (result.whisperVersion) {
      whisperVersion = result.whisperVersion
    }
  }

  // Write version file
  fs.writeFileSync(
    path.join(WHISPER_DIR, "VERSION"),
    `whisper-cpp: ${whisperVersion}\ndownloaded: ${new Date().toISOString()}\n`
  )

  if (allSuccess) {
    console.log("\n✅ All downloads completed successfully!")
    console.log(`\nBinaries saved to: ${WHISPER_DIR}`)
  } else {
    console.error("\n❌ Some downloads failed")
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
