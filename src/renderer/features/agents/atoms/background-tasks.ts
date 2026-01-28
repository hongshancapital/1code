/**
 * Background tasks state management
 * Tracks background tasks spawned by Claude Agent SDK
 */

import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import type { BackgroundTask, BackgroundTaskStatus } from "../types/background-task"

/**
 * All background tasks storage (grouped by subChatId)
 * Using a simple atom since tasks are ephemeral per session
 */
const allBackgroundTasksAtom = atom<Record<string, BackgroundTask[]>>({})

/**
 * Get/set background tasks for a specific subChat
 */
export const backgroundTasksAtomFamily = atomFamily((subChatId: string) =>
  atom(
    (get) => get(allBackgroundTasksAtom)[subChatId] ?? [],
    (get, set, update: BackgroundTask[] | ((prev: BackgroundTask[]) => BackgroundTask[])) => {
      const current = get(allBackgroundTasksAtom)
      const prev = current[subChatId] ?? []
      const next = typeof update === "function" ? update(prev) : update
      set(allBackgroundTasksAtom, { ...current, [subChatId]: next })
    }
  )
)

/**
 * Count of running tasks for a specific subChat (derived atom)
 */
export const runningTasksCountAtomFamily = atomFamily((subChatId: string) =>
  atom((get) => {
    const tasks = get(backgroundTasksAtomFamily(subChatId))
    return tasks.filter((t) => t.status === "running").length
  })
)

/**
 * All running tasks across all subChats (derived atom)
 */
export const allRunningTasksAtom = atom((get) => {
  const allTasks = get(allBackgroundTasksAtom)
  const running: BackgroundTask[] = []
  for (const tasks of Object.values(allTasks)) {
    running.push(...tasks.filter((t) => t.status === "running"))
  }
  return running
})

/**
 * Helper to add a new background task
 */
export function createBackgroundTask(
  subChatId: string,
  taskId: string,
  shellId: string,
  summary: string,
  command?: string
): BackgroundTask {
  return {
    taskId,
    shellId,
    status: "running",
    summary,
    startedAt: Date.now(),
    subChatId,
    command,
  }
}

/**
 * Helper to update task status
 */
export function updateTaskStatus(
  task: BackgroundTask,
  status: BackgroundTaskStatus
): BackgroundTask {
  return {
    ...task,
    status,
    completedAt: status !== "running" ? Date.now() : undefined,
  }
}
