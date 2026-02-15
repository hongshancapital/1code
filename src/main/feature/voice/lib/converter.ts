/**
 * Audio format converter
 * Converts audio from various formats to 16kHz WAV for whisper-cli
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { getFfmpegBinaryPath, isFfmpegBinaryAvailable } from "./env"
import { createLogger } from "../../../lib/logger"

const whisperLog = createLogger("Whisper")


export interface ConversionResult {
  wavPath: string
  duration: number // seconds
  cleanup: () => Promise<void>
}

/**
 * Convert audio buffer to 16kHz mono WAV
 * @param inputBuffer - Audio data as Buffer
 * @param inputFormat - Source format (webm, mp3, m4a, ogg, wav)
 * @returns Path to converted WAV file and cleanup function
 */
export async function convertToWav(
  inputBuffer: Buffer,
  inputFormat: string
): Promise<ConversionResult> {
  if (!isFfmpegBinaryAvailable()) {
    throw new Error("ffmpeg binary not found. Run 'bun run whisper:download' to install.")
  }

  const ffmpegPath = getFfmpegBinaryPath()

  // Create temp files
  const tempDir = os.tmpdir()
  const timestamp = Date.now()
  const inputPath = path.join(tempDir, `whisper-input-${timestamp}.${inputFormat}`)
  const outputPath = path.join(tempDir, `whisper-output-${timestamp}.wav`)

  // Write input buffer to temp file
  fs.writeFileSync(inputPath, inputBuffer)

  try {
    // Convert to 16kHz mono WAV
    const { duration } = await runFfmpeg(ffmpegPath, inputPath, outputPath)

    return {
      wavPath: outputPath,
      duration,
      cleanup: async () => {
        // Remove temp files
        try {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
        } catch (err) {
          whisperLog.warn("Failed to cleanup temp files:", err)
        }
      },
    }
  } catch (error) {
    // Cleanup on error
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    } catch {}
    throw error
  }
}

/**
 * Run ffmpeg to convert audio
 */
function runFfmpeg(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string
): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    // ffmpeg arguments:
    // -i input: input file
    // -ar 16000: resample to 16kHz (whisper requirement)
    // -ac 1: convert to mono
    // -f wav: output format
    // -y: overwrite output
    const args = [
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "-y",
      outputPath,
    ]

    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stderr = ""
    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`))
        return
      }

      // Parse duration from ffmpeg output
      // Format: Duration: 00:00:05.12
      const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
      let duration = 0
      if (durationMatch) {
        const hours = parseInt(durationMatch[1], 10)
        const minutes = parseInt(durationMatch[2], 10)
        const seconds = parseFloat(durationMatch[3])
        duration = hours * 3600 + minutes * 60 + seconds
      }

      resolve({ duration })
    })

    proc.on("error", (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`))
    })

    // Timeout after 60 seconds
    setTimeout(() => {
      proc.kill("SIGKILL")
      reject(new Error("ffmpeg conversion timed out"))
    }, 60000)
  })
}
