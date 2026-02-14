import { useEffect, useRef, useMemo } from "react"
import { useSetAtom } from "jotai"
import type { Message } from "@ai-sdk/react"
import { planEditRefetchTriggerAtomFamily } from "../atoms"
import { isPlanFile } from "../ui/agent-tool-utils"

export interface UsePlanEditTrackingOptions {
  messages: Message[]
  subChatId: string
}

/**
 * Hook to track plan Edit tool completions and trigger sidebar refetch.
 *
 * Monitors messages for completed Edit tool calls that target plan files
 * (generic-*.md pattern). When a new Edit is completed, triggers a refetch
 * of the plan sidebar to show updated content.
 */
export function usePlanEditTracking({
  messages,
  subChatId,
}: UsePlanEditTrackingOptions): void {
  const triggerPlanEditRefetch = useSetAtom(
    useMemo(() => planEditRefetchTriggerAtomFamily(subChatId), [subChatId])
  )
  const lastPlanEditCountRef = useRef(0)

  useEffect(() => {
    // Count completed plan Edits
    let completedPlanEdits = 0
    for (const msg of messages) {
      const msgWithParts = msg as Message
      if (msgWithParts.role !== "assistant" || !msgWithParts.parts) continue
      for (const part of msgWithParts.parts) {
        if (
          part.type === "tool-Edit" &&
          part.state !== "input-streaming" &&
          part.state !== "pending" &&
          isPlanFile((part.input?.file_path as string) || "")
        ) {
          completedPlanEdits++
        }
      }
    }

    // Trigger refetch if count increased (new Edit completed)
    if (completedPlanEdits > lastPlanEditCountRef.current) {
      lastPlanEditCountRef.current = completedPlanEdits
      triggerPlanEditRefetch()
    }
  }, [messages, triggerPlanEditRefetch])
}
