/**
 * Web Worker for audio level analysis
 * Offloads audio processing from main thread to prevent UI blocking
 */

interface AudioAnalysisMessage {
  type: "analyze"
  audioData: ArrayBuffer
}

interface AudioLevelMessage {
  type: "level"
  level: number
}

self.onmessage = async (event: MessageEvent<AudioAnalysisMessage>) => {
  const { type, audioData } = event.data

  if (type === "analyze") {
    try {
      // Create audio context in worker
      const audioContext = new AudioContext({
        sampleRate: 16000,
      })

      // Decode the audio data
      const audioBuffer = await audioContext.decodeAudioData(audioData)

      // Get channel data
      const channelData = audioBuffer.getChannelData(0)

      // Calculate RMS (Root Mean Square) for audio level
      let sum = 0
      const samples = channelData.length

      // Use a subset of samples for performance (every 4th sample)
      const step = Math.max(1, Math.floor(samples / 1000))
      let count = 0

      for (let i = 0; i < samples; i += step) {
        const sample = channelData[i]
        sum += sample * sample
        count++
      }

      const rms = Math.sqrt(sum / count)

      // Convert to 0-1 range with power curve for better visibility
      // Use a gentler curve since we want the worker to be fast
      const level = Math.min(1, Math.pow(rms * 3, 0.7))

      // Send level back to main thread
      self.postMessage({
        type: "level",
        level,
      } as AudioLevelMessage)

      // Close audio context
      await audioContext.close()
    } catch (error) {
      // Return 0 on error
      self.postMessage({
        type: "level",
        level: 0,
      } as AudioLevelMessage)
    }
  }
}

// Keep worker alive
self.onerror = () => {}
