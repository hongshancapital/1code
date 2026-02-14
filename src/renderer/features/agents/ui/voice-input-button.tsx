"use client"

import { memo, useCallback, useState, useRef, useEffect } from "react"
import { Mic, Loader2, Sparkles } from "lucide-react"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"
import {
  useVoiceRecording,
  blobToBase64,
  getAudioFormat,
} from "../../../lib/hooks/use-voice-recording"

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  className?: string
}

/**
 * Voice input button with hold-to-talk functionality
 *
 * Features:
 * - Real-time interim transcription while recording
 * - Full transcription on release
 * - Audio level visualization
 * - Touch and mouse support
 */
export const VoiceInputButton = memo(function VoiceInputButton({
  onTranscript,
  disabled = false,
  className,
}: VoiceInputButtonProps) {
  const [interimTranscript, setInterimTranscript] = useState<string>("")
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)

  // Track if we're using touch to prevent duplicate mouse events
  const isTouchRef = useRef(false)

  // Ref to track if component is mounted (for async operations)
  const isMountedRef = useRef(true)

  // Ref to track if interim transcription is in progress
  const isInterimTranscribingRef = useRef(false)

  // Refs for cleanup
  const interimAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Cancel any pending interim requests
      if (interimAbortControllerRef.current) {
        interimAbortControllerRef.current.abort()
      }
    }
  }, [])

  const transcribeMutation = trpc.voice.transcribe.useMutation({
    onError: (err) => {
      console.error("[VoiceInput] Transcription error:", err)
      if (isMountedRef.current) {
        setTranscribeError(err.message)
      }
    },
  })

  // Handle interim audio for real-time transcription
  const handleInterimAudio = useCallback(async (chunks: Blob[], _audioLevel: number) => {
    // Skip if already transcribing or component unmounted
    if (isInterimTranscribingRef.current || !isMountedRef.current) return
    if (chunks.length === 0) return

    // Calculate total size - skip if too small (lower threshold for faster interim results)
    const totalSize = chunks.reduce((acc, chunk) => acc + chunk.size, 0)
    if (totalSize < 2000) return // Need at least ~2KB for meaningful transcription

    isInterimTranscribingRef.current = true

    // Cancel previous interim request
    if (interimAbortControllerRef.current) {
      interimAbortControllerRef.current.abort()
    }
    interimAbortControllerRef.current = new AbortController()

    try {
      // Combine chunks into a single blob
      const audioBlob = new Blob(chunks, { type: "audio/webm" })
      const base64 = await blobToBase64(audioBlob)
      const format = getAudioFormat(audioBlob.type)

      // Use fetch directly for more control over cancellation
      // Note: We're using the tRPC mutation internally, but for interim we want
      // to avoid the React Query cache overhead

      // Use "tiny" model for interim transcription for faster results
      // The tiny model is much faster (~10x) than small model
      const response = await fetch("/trpc/voice.transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          json: {
            audio: base64,
            format,
            modelId: "tiny", // Use tiny for fast interim transcription
          },
        }),
        signal: interimAbortControllerRef.current.signal,
      })

      if (!response.ok) {
        // Ignore errors during interim transcription
        console.warn("[VoiceInput] Interim transcription failed:", response.status)
        return
      }

      const result = await response.json()

      // Extract text from tRPC response
      if (result?.result?.data?.json?.text) {
        const text = result.result.data.json.text
        if (text && text.trim() && isMountedRef.current) {
          setInterimTranscript(text.trim())
        }
      }
    } catch (err) {
      // Ignore abort errors and network errors
      if (err instanceof Error && err.name !== "AbortError") {
        console.warn("[VoiceInput] Interim transcription error:", err)
      }
    } finally {
      isInterimTranscribingRef.current = false
    }
  }, [])

  const { isRecording, startRecording, stopRecording, cancelRecording, error } =
    useVoiceRecording({
      onInterimAudio: handleInterimAudio,
      interimIntervalMs: 1000, // Send interim audio every 1 second for real-time feel
    })

  const handleStart = useCallback(async () => {
    if (disabled || isTranscribing || isRecording) return

    setTranscribeError(null)
    setInterimTranscript("")

    try {
      await startRecording()
    } catch (err) {
      console.error("[VoiceInput] Failed to start recording:", err)
    }
  }, [disabled, isTranscribing, isRecording, startRecording])

  const handleEnd = useCallback(async () => {
    if (!isRecording) return

    try {
      const blob = await stopRecording()

      // Clear interim transcript immediately
      setInterimTranscript("")

      // Don't transcribe very short recordings (likely accidental clicks)
      if (blob.size < 1000) {
        console.log("[VoiceInput] Recording too short, ignoring")
        return
      }

      if (!isMountedRef.current) return

      setIsTranscribing(true)

      const base64 = await blobToBase64(blob)
      const format = getAudioFormat(blob.type)

      const result = await transcribeMutation.mutateAsync({
        audio: base64,
        format,
      })

      if (!isMountedRef.current) return

      if (result.text && result.text.trim()) {
        onTranscript(result.text.trim())
      }
    } catch (err) {
      console.error("[VoiceInput] Transcription failed:", err)
    } finally {
      if (isMountedRef.current) {
        setIsTranscribing(false)
        setInterimTranscript("")
      }
    }
  }, [isRecording, stopRecording, transcribeMutation, onTranscript])

  // Mouse handlers - skip if touch was used
  const handleMouseDown = useCallback(() => {
    if (isTouchRef.current) {
      isTouchRef.current = false
      return
    }
    handleStart()
  }, [handleStart])

  const handleMouseUp = useCallback(() => {
    if (isTouchRef.current) return
    handleEnd()
  }, [handleEnd])

  const handleMouseLeave = useCallback(() => {
    if (isTouchRef.current) return
    if (isRecording) {
      // Cancel instead of transcribing when leaving button area
      cancelRecording()
      setInterimTranscript("")
    }
  }, [isRecording, cancelRecording])

  // Touch handlers - set flag to prevent mouse events
  const handleTouchStart = useCallback(() => {
    isTouchRef.current = true
    handleStart()
  }, [handleStart])

  const handleTouchEnd = useCallback(() => {
    handleEnd()
  }, [handleEnd])

  const isLoading = isTranscribing || transcribeMutation.isPending
  const hasError = !!error || !!transcribeError

  // Show interim transcript when recording with partial results
  const showInterim = isRecording && interimTranscript.length > 0

  return (
    <div className="relative">
      <button
        type="button"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        disabled={disabled || isLoading}
        title={
          hasError
            ? transcribeError || error?.message || "Voice input error"
            : isRecording
              ? "Release to transcribe"
              : "Hold to record"
        }
        className={cn(
          "relative p-1.5 rounded-md transition-all duration-150 ease-out",
          "hover:bg-accent active:scale-[0.97]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          isRecording && "bg-red-500/20 ring-2 ring-red-500",
          isLoading && "bg-yellow-500/20",
          hasError && "bg-red-500/10",
          className
        )}
      >
        <div className="relative w-4 h-4">
          {isLoading ? (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          ) : (
            <Mic
              className={cn(
                "w-4 h-4 transition-colors",
                isRecording
                  ? "text-red-500 animate-pulse"
                  : hasError
                    ? "text-red-500/70"
                    : "text-muted-foreground"
              )}
            />
          )}
        </div>

        {/* Recording indicator dot */}
        {isRecording && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        )}
      </button>

      {/* Interim transcript tooltip */}
      {showInterim && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-yellow-500/90 text-yellow-950 text-xs rounded-md shadow-lg whitespace-nowrap flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-1">
          <Sparkles className="w-3 h-3" />
          <span>{interimTranscript}</span>
        </div>
      )}
    </div>
  )
})
