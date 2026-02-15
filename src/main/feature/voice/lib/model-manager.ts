/**
 * Whisper model download and management
 */

import fs from "node:fs"
import https from "node:https"
import {
  getWhisperModelsDir,
  getModelPath,
  isModelDownloaded,
  getModelFileSize,
  WHISPER_MODELS,
  type WhisperModelId,
} from "./env"
import { createLogger } from "../../../lib/logger"

const whisperLog = createLogger("Whisper")


export interface ModelStatus {
  id: WhisperModelId
  name: string
  description: string
  expectedSize: number
  downloaded: boolean
  downloadedSize: number | null
  downloading: boolean
  progress: number // 0-100
  error?: string
}

// Track active downloads
const activeDownloads = new Map<
  WhisperModelId,
  {
    controller: AbortController
    progress: number
  }
>()

/**
 * Get status of all models
 */
export function getAllModelStatus(): ModelStatus[] {
  return Object.values(WHISPER_MODELS).map((model) => {
    const download = activeDownloads.get(model.id as WhisperModelId)
    return {
      id: model.id as WhisperModelId,
      name: model.name,
      description: model.description,
      expectedSize: model.size,
      downloaded: isModelDownloaded(model.id),
      downloadedSize: getModelFileSize(model.id),
      downloading: !!download,
      progress: download?.progress || 0,
    }
  })
}

/**
 * Get status of a specific model
 */
export function getModelStatus(modelId: WhisperModelId): ModelStatus | null {
  const model = WHISPER_MODELS[modelId]
  if (!model) return null

  const download = activeDownloads.get(modelId)
  return {
    id: modelId,
    name: model.name,
    description: model.description,
    expectedSize: model.size,
    downloaded: isModelDownloaded(modelId),
    downloadedSize: getModelFileSize(modelId),
    downloading: !!download,
    progress: download?.progress || 0,
  }
}

/**
 * Download a model
 * @param modelId - Model to download
 * @param onProgress - Progress callback (0-100)
 * @returns Promise that resolves when download completes
 */
export async function downloadModel(
  modelId: WhisperModelId,
  onProgress?: (progress: number) => void
): Promise<void> {
  const model = WHISPER_MODELS[modelId]
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`)
  }

  // Check if already downloading
  if (activeDownloads.has(modelId)) {
    throw new Error(`Model ${modelId} is already being downloaded`)
  }

  // Check if already downloaded
  if (isModelDownloaded(modelId)) {
    whisperLog.info(`Model ${modelId} already downloaded`)
    return
  }

  const _modelsDir = getWhisperModelsDir()
  const modelPath = getModelPath(modelId)
  const tempPath = `${modelPath}.download`

  // Set up download tracking
  const controller = new AbortController()
  activeDownloads.set(modelId, { controller, progress: 0 })

  try {
    whisperLog.info(`Downloading model ${modelId} from ${model.url}`)

    await downloadFile(model.url, tempPath, model.size, (progress) => {
      const download = activeDownloads.get(modelId)
      if (download) download.progress = progress
      onProgress?.(progress)
    }, controller.signal)

    // Verify file size
    const actualSize = fs.statSync(tempPath).size
    if (actualSize < model.size * 0.9) {
      throw new Error(`Downloaded file is too small (${actualSize} bytes, expected ~${model.size})`)
    }

    // Move to final location
    fs.renameSync(tempPath, modelPath)

    whisperLog.info(`Model ${modelId} downloaded successfully`)
  } finally {
    activeDownloads.delete(modelId)

    // Cleanup temp file if exists
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    } catch {}
  }
}

/**
 * Cancel an active download
 */
export function cancelDownload(modelId: WhisperModelId): boolean {
  const download = activeDownloads.get(modelId)
  if (!download) return false

  download.controller.abort()
  activeDownloads.delete(modelId)

  // Cleanup temp file
  const tempPath = `${getModelPath(modelId)}.download`
  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
  } catch {}

  return true
}

/**
 * Delete a downloaded model
 */
export function deleteModel(modelId: WhisperModelId): boolean {
  const modelPath = getModelPath(modelId)
  try {
    if (fs.existsSync(modelPath)) {
      fs.unlinkSync(modelPath)
      return true
    }
    return false
  } catch (err) {
    whisperLog.error(`Failed to delete model ${modelId}:`, err)
    return false
  }
}

/**
 * Download file with progress
 */
function downloadFile(
  url: string,
  destPath: string,
  expectedSize: number,
  onProgress: (progress: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    let downloaded = 0
    let lastProgress = 0

    const handleError = (err: Error) => {
      file.close()
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      } catch {}
      reject(err)
    }

    const request = (url: string) => {
      const urlObj = new URL(url)
      const _isHttps = urlObj.protocol === "https:"

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: {
          "User-Agent": "hong-desktop/1.0",
        },
      }

      const req = https.get(options, (res) => {
        // Handle redirects
        if ([301, 302, 307, 308].includes(res.statusCode || 0)) {
          const location = res.headers.location
          if (location) {
            return request(location)
          }
          return handleError(new Error("Redirect without location"))
        }

        if (res.statusCode !== 200) {
          return handleError(new Error(`HTTP ${res.statusCode}`))
        }

        const totalSize = parseInt(res.headers["content-length"] || "0", 10) || expectedSize

        res.on("data", (chunk) => {
          downloaded += chunk.length
          const progress = Math.floor((downloaded / totalSize) * 100)
          if (progress !== lastProgress) {
            lastProgress = progress
            onProgress(progress)
          }
        })

        res.pipe(file)

        file.on("finish", () => {
          file.close()
          resolve()
        })

        res.on("error", handleError)
      })

      req.on("error", handleError)

      // Handle abort
      signal.addEventListener("abort", () => {
        req.destroy()
        handleError(new Error("Download cancelled"))
      })
    }

    request(url)
  })
}

/**
 * Get the first available model (for auto-selection)
 */
export function getFirstAvailableModel(): WhisperModelId | null {
  for (const modelId of ["tiny", "base", "small"] as WhisperModelId[]) {
    if (isModelDownloaded(modelId)) {
      return modelId
    }
  }
  return null
}
