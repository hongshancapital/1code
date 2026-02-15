/**
 * Voice Extension
 *
 * 语音转文字（本地 Whisper / OpenAI API）。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { voiceRouter } from "./router"

class VoiceExtension implements ExtensionModule {
  name = "voice" as const
  description = "Voice-to-text transcription via local Whisper or OpenAI API"
  router = voiceRouter
}

export const voiceExtension = new VoiceExtension()
