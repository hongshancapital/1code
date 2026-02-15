/**
 * Whisper local speech-to-text module
 *
 * Usage:
 * ```typescript
 * import { transcribeLocalAudio } from './whisper'
 *
 * const result = await transcribeLocalAudio(audioBuffer, 'webm', {
 *   modelId: 'tiny',
 *   language: 'auto',
 * })
 * log.info(result.text)
 * ```
 */

// Re-export everything
export * from "./env"
export * from "./converter"
export * from "./transcriber"
export * from "./model-manager"

// Convenience function that combines conversion + transcription
import { convertToWav } from "./converter"
import { transcribeAudio, type TranscribeOptions, type TranscribeResult } from "./transcriber"
import { createLogger } from "../../../lib/logger"

const log = createLogger("index")


export interface LocalTranscribeOptions extends Omit<TranscribeOptions, "modelId"> {
  modelId?: TranscribeOptions["modelId"]
}

/**
 * Transcribe audio from any supported format
 * Handles conversion to WAV automatically
 *
 * @param audioBuffer - Audio data as Buffer
 * @param format - Source format (webm, mp3, m4a, ogg, wav)
 * @param options - Transcription options
 */
export async function transcribeLocalAudio(
  audioBuffer: Buffer,
  format: string,
  options: LocalTranscribeOptions = {}
): Promise<TranscribeResult> {
  const { modelId = "tiny", ...transcribeOptions } = options

  // Convert to WAV
  const conversion = await convertToWav(audioBuffer, format)

  try {
    // Transcribe
    const result = await transcribeAudio(conversion.wavPath, {
      modelId,
      ...transcribeOptions,
    })

    return result
  } finally {
    // Cleanup temp files
    await conversion.cleanup()
  }
}
