/**
 * Notifies the main process when all background tasks and streaming operations
 * become idle, so the main process knows it is safe to perform maintenance tasks.
 */

import { useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { allRunningTasksAtom } from "../atoms"
import { useStreamingStatusStore } from "../../features/agents/stores/streaming-status-store"

export function useTasksIdleNotifier() {
  const runningTasks = useAtomValue(allRunningTasksAtom)
  const statuses = useStreamingStatusStore((s) => s.statuses)
  const prevIdleRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (!window.desktopApi?.notifyTasksIdle) return

    const hasRunningTasks = runningTasks.length > 0
    const hasActiveStreaming = Object.values(statuses).some(
      (status) => status === "streaming" || status === "submitted"
    )

    const isIdle = !hasRunningTasks && !hasActiveStreaming

    // Only notify on actual change to avoid spamming IPC
    if (prevIdleRef.current !== isIdle) {
      prevIdleRef.current = isIdle
      window.desktopApi.notifyTasksIdle(isIdle)
    }
  }, [runningTasks, statuses])
}
