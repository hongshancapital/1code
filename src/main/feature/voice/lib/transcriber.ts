/**
 * Whisper CLI transcription wrapper
 * Runs whisper-cli to transcribe audio files
 */

import { spawn } from "node:child_process"
import {
  getWhisperBinaryPath,
  getWhisperEnv,
  getModelPath,
  isWhisperBinaryAvailable,
  isModelDownloaded,
  type WhisperModelId,
} from "./env"
import { createLogger } from "../../../lib/logger"

const whisperLog = createLogger("Whisper")


export interface TranscribeOptions {
  /** Model to use for transcription */
  modelId: WhisperModelId
  /** Language code (ISO 639-1) or "auto" for detection */
  language?: string
  /** Number of threads (default: 4) */
  threads?: number
  /** Timeout in milliseconds (default: 120000) */
  timeout?: number
}

export interface TranscribeResult {
  /** Transcribed text */
  text: string
  /** Detected language (if language was "auto") */
  detectedLanguage?: string
  /** Processing time in milliseconds */
  processingTime: number
}

/**
 * Transcribe audio file using whisper-cli
 * @param wavPath - Path to 16kHz mono WAV file
 * @param options - Transcription options
 */
export async function transcribeAudio(
  wavPath: string,
  options: TranscribeOptions
): Promise<TranscribeResult> {
  const {
    modelId,
    language = "auto",
    threads = 4,
    timeout = 120000,
  } = options

  // Validate prerequisites
  if (!isWhisperBinaryAvailable()) {
    throw new Error("whisper-cli not found. Run 'bun run whisper:download' to install.")
  }

  if (!isModelDownloaded(modelId)) {
    throw new Error(`Model '${modelId}' not downloaded. Download it in Settings > Voice.`)
  }

  const whisperPath = getWhisperBinaryPath()
  const modelPath = getModelPath(modelId)

  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    // whisper-cli arguments:
    // -m model: model file path
    // -f file: input audio file
    // -l language: language code or "auto"
    // -t threads: number of threads
    // --no-timestamps: don't include timestamps in output
    // -otxt: output as plain text
    const args = [
      "-m", modelPath,
      "-f", wavPath,
      "-l", language,
      "-t", threads.toString(),
      "--no-timestamps",
      "-oj", // Output JSON for better parsing
    ]

    const proc = spawn(whisperPath, args, {
      env: getWhisperEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    const timeoutId = setTimeout(() => {
      proc.kill("SIGKILL")
      reject(new Error("Transcription timed out"))
    }, timeout)

    proc.on("close", (code) => {
      clearTimeout(timeoutId)
      const processingTime = Date.now() - startTime

      if (code !== 0) {
        whisperLog.error("stderr:", stderr)
        reject(new Error(`whisper-cli exited with code ${code}`))
        return
      }

      try {
        // Parse JSON output
        const result = parseWhisperOutput(stdout)
        resolve({
          text: result.text,
          detectedLanguage: result.language,
          processingTime,
        })
      } catch (err) {
        // Fallback: try to extract text from plain output
        const text = extractTextFromOutput(stdout)
        if (text) {
          resolve({
            text,
            processingTime,
          })
        } else {
          reject(new Error(`Failed to parse whisper output: ${err}`))
        }
      }
    })

    proc.on("error", (err) => {
      clearTimeout(timeoutId)
      reject(new Error(`Failed to start whisper-cli: ${err.message}`))
    })
  })
}

/**
 * Parse whisper JSON output
 */
function parseWhisperOutput(output: string): { text: string; language?: string } {
  // whisper-cli -oj outputs JSON with segments
  // Try to find and parse the JSON block
  const jsonMatch = output.match(/\{[\s\S]*"transcription"[\s\S]*\}/)
  if (jsonMatch) {
    const json = JSON.parse(jsonMatch[0])
    // Extract text from segments
    if (Array.isArray(json.transcription)) {
      const text = json.transcription
        .map((seg: { text?: string }) => seg.text?.trim() || "")
        .join(" ")
        .trim()
      return { text, language: json.result?.language }
    }
  }

  // Try simpler JSON format
  const simpleJson = output.match(/\[\s*\{[\s\S]*\}\s*\]/)
  if (simpleJson) {
    const segments = JSON.parse(simpleJson[0])
    const text = segments
      .map((seg: { text?: string }) => seg.text?.trim() || "")
      .join(" ")
      .trim()
    return { text }
  }

  throw new Error("Could not find JSON in output")
}

/**
 * Extract text from plain whisper output (fallback)
 */
function extractTextFromOutput(output: string): string | null {
  // Remove timestamps like [00:00:00.000 --> 00:00:05.000]
  const lines = output
    .split("\n")
    .map((line) => line.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, ""))
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[") && !line.startsWith("whisper"))

  if (lines.length > 0) {
    return lines.join(" ").trim()
  }

  return null
}

/**
 * Check if transcription is available (binary + at least one model)
 */
export function isTranscriptionAvailable(): {
  available: boolean
  reason?: string
} {
  if (!isWhisperBinaryAvailable()) {
    return {
      available: false,
      reason: "whisper-cli not installed",
    }
  }

  // Check if any model is downloaded
  const hasModel = isModelDownloaded("tiny") ||
    isModelDownloaded("base") ||
    isModelDownloaded("small")

  if (!hasModel) {
    return {
      available: false,
      reason: "No whisper model downloaded",
    }
  }

  return { available: true }
}
