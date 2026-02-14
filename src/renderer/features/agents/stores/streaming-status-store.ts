import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"
import { trackAIResponseDuration } from "../../../lib/sensors-analytics"

export type StreamingStatus = "ready" | "streaming" | "submitted" | "error"

interface StreamingStatusState {
  // Map: subChatId -> streaming status
  statuses: Record<string, StreamingStatus>

  // Actions
  setStatus: (subChatId: string, status: StreamingStatus) => void
  getStatus: (subChatId: string) => StreamingStatus
  isStreaming: (subChatId: string) => boolean
  clearStatus: (subChatId: string) => void

  // Get all sub-chats that are ready (not streaming)
  getReadySubChats: () => string[]
}

// Track AI response start times per subChatId (outside store to avoid re-renders)
const turnStartTimes = new Map<string, number>()

export const useStreamingStatusStore = create<StreamingStatusState>()(
  subscribeWithSelector((set, get) => ({
    statuses: {},

    setStatus: (subChatId, status) => {
      const prevStatus = get().statuses[subChatId] ?? "ready"

      // Record start time when a turn begins (ready/error -> submitted)
      if (
        (prevStatus === "ready" || prevStatus === "error") &&
        status === "submitted"
      ) {
        turnStartTimes.set(subChatId, Date.now())
      }

      // Report duration when a turn ends (submitted/streaming -> ready/error)
      if (
        (prevStatus === "submitted" || prevStatus === "streaming") &&
        (status === "ready" || status === "error")
      ) {
        const startTime = turnStartTimes.get(subChatId)
        if (startTime !== undefined) {
          turnStartTimes.delete(subChatId)
          trackAIResponseDuration(Date.now() - startTime, status === "ready" ? "success" : "error")
        }
      }

      set((state) => ({
        statuses: {
          ...state.statuses,
          [subChatId]: status,
        },
      }))
    },

    getStatus: (subChatId) => {
      return get().statuses[subChatId] ?? "ready"
    },

    isStreaming: (subChatId) => {
      const status = get().statuses[subChatId] ?? "ready"
      return status === "streaming" || status === "submitted"
    },

    clearStatus: (subChatId) => {
      turnStartTimes.delete(subChatId)
      set((state) => {
        const newStatuses = { ...state.statuses }
        delete newStatuses[subChatId]
        return { statuses: newStatuses }
      })
    },

    getReadySubChats: () => {
      const { statuses } = get()
      return Object.entries(statuses)
        .filter(([_, status]) => status === "ready")
        .map(([subChatId]) => subChatId)
    },
  }))
)
