/**
 * Whisper binary environment configuration
 * Manages paths for whisper-cli, ffmpeg, and model files
 */

import { app } from "electron"
import path from "node:path"
import fs from "node:fs"

// Binary names by platform
const WHISPER_BINARY = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"
const FFMPEG_BINARY = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"

// Cached paths
let cachedWhisperPath: string | null = null
let cachedFfmpegPath: string | null = null
let cachedModelsDir: string | null = null

/**
 * Get the path to the bundled whisper-cli binary
 */
export function getWhisperBinaryPath(): string {
  if (cachedWhisperPath) return cachedWhisperPath

  const isDev = !app.isPackaged
  const platform = process.platform
  const arch = process.arch

  let basePath: string
  if (isDev) {
    basePath = path.join(app.getAppPath(), "resources", "whisper", `${platform}-${arch}`)
  } else {
    basePath = path.join(process.resourcesPath, "whisper")
  }

  cachedWhisperPath = path.join(basePath, WHISPER_BINARY)
  return cachedWhisperPath
}

/**
 * Get the path to the bundled ffmpeg binary
 */
export function getFfmpegBinaryPath(): string {
  if (cachedFfmpegPath) return cachedFfmpegPath

  const isDev = !app.isPackaged
  const platform = process.platform
  const arch = process.arch

  let basePath: string
  if (isDev) {
    basePath = path.join(app.getAppPath(), "resources", "whisper", `${platform}-${arch}`)
  } else {
    basePath = path.join(process.resourcesPath, "whisper")
  }

  cachedFfmpegPath = path.join(basePath, FFMPEG_BINARY)
  return cachedFfmpegPath
}

/**
 * Get the whisper lib directory (for dylibs on macOS/Linux)
 */
export function getWhisperLibDir(): string {
  const isDev = !app.isPackaged
  const platform = process.platform
  const arch = process.arch

  if (isDev) {
    return path.join(app.getAppPath(), "resources", "whisper", `${platform}-${arch}`, "lib")
  }
  return path.join(process.resourcesPath, "whisper", "lib")
}

/**
 * Get environment variables for running whisper-cli
 * Sets up library paths for dynamic linking
 */
export function getWhisperEnv(): NodeJS.ProcessEnv {
  const libDir = getWhisperLibDir()
  const env = { ...process.env }

  if (process.platform === "darwin") {
    // macOS: DYLD_LIBRARY_PATH
    env.DYLD_LIBRARY_PATH = libDir + (env.DYLD_LIBRARY_PATH ? `:${env.DYLD_LIBRARY_PATH}` : "")
  } else if (process.platform === "linux") {
    // Linux: LD_LIBRARY_PATH
    env.LD_LIBRARY_PATH = libDir + (env.LD_LIBRARY_PATH ? `:${env.LD_LIBRARY_PATH}` : "")
  }
  // Windows doesn't need PATH modification if dlls are in same dir as exe

  return env
}

/**
 * Get the directory for whisper models
 * Models are stored in userData to allow runtime downloads
 */
export function getWhisperModelsDir(): string {
  if (cachedModelsDir) return cachedModelsDir

  cachedModelsDir = path.join(app.getPath("userData"), "whisper-models")

  // Ensure directory exists
  if (!fs.existsSync(cachedModelsDir)) {
    fs.mkdirSync(cachedModelsDir, { recursive: true })
  }

  return cachedModelsDir
}

/**
 * Get path to a specific model file
 */
export function getModelPath(modelId: string): string {
  return path.join(getWhisperModelsDir(), `ggml-${modelId}.bin`)
}

/**
 * Check if whisper binary exists and is executable
 */
export function isWhisperBinaryAvailable(): boolean {
  const binaryPath = getWhisperBinaryPath()

  try {
    const stats = fs.statSync(binaryPath)
    if (!stats.isFile()) return false

    // Check executable permission on Unix
    if (process.platform !== "win32") {
      fs.accessSync(binaryPath, fs.constants.X_OK)
    }

    return true
  } catch {
    return false
  }
}

/**
 * Check if ffmpeg binary exists and is executable
 */
export function isFfmpegBinaryAvailable(): boolean {
  const binaryPath = getFfmpegBinaryPath()

  try {
    const stats = fs.statSync(binaryPath)
    if (!stats.isFile()) return false

    if (process.platform !== "win32") {
      fs.accessSync(binaryPath, fs.constants.X_OK)
    }

    return true
  } catch {
    return false
  }
}

/**
 * Check if a model is downloaded
 */
export function isModelDownloaded(modelId: string): boolean {
  const modelPath = getModelPath(modelId)
  return fs.existsSync(modelPath)
}

/**
 * Get model file size (for progress display)
 */
export function getModelFileSize(modelId: string): number | null {
  const modelPath = getModelPath(modelId)
  try {
    return fs.statSync(modelPath).size
  } catch {
    return null
  }
}

// Model metadata
export const WHISPER_MODELS = {
  tiny: {
    id: "tiny",
    name: "Tiny",
    size: 77 * 1024 * 1024, // 77 MB
    description: "Fastest, good for quick transcription",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
  },
  base: {
    id: "base",
    name: "Base",
    size: 148 * 1024 * 1024, // 148 MB
    description: "Better accuracy, still fast",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
  },
  small: {
    id: "small",
    name: "Small",
    size: 488 * 1024 * 1024, // 488 MB
    description: "High accuracy, slower",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
  },
} as const

export type WhisperModelId = keyof typeof WHISPER_MODELS
