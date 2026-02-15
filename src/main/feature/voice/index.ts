/**
 * Voice Extension
 *
 * 将 Voice/Whisper 语音输入功能封装为 Extension。
 * 实现文件保留在 lib/whisper/，此处为轻量 wrapper 提供 router。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { voiceRouter } from "../../lib/trpc/routers/voice"

class VoiceExtension implements ExtensionModule {
  name = "voice" as const
  description = "Voice-to-text transcription via local Whisper or OpenAI API"
  router = voiceRouter
}

export const voiceExtension = new VoiceExtension()
