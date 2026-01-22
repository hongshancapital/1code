import { useEffect, useMemo } from "react"
import { useSetAtom } from "jotai"
import { deliverablesAtomFamily, type Deliverable } from "./atoms"

/**
 * Hook to listen for file-changed events from Claude tools
 * and automatically add them to the deliverables list for the current sub-chat
 */
export function useDeliverablesListener(subChatId: string | null) {
  const effectiveId = subChatId || "default"
  const deliverablesAtom = useMemo(
    () => deliverablesAtomFamily(effectiveId),
    [effectiveId]
  )
  const setDeliverables = useSetAtom(deliverablesAtom)

  useEffect(() => {
    if (!window.desktopApi?.onFileChanged) {
      console.log("[Deliverables] onFileChanged not available")
      return
    }

    console.log("[Deliverables] Listening for file changes, subChatId:", effectiveId)

    const unsubscribe = window.desktopApi.onFileChanged((data) => {
      console.log("[Deliverables] Received file-changed event:", data)
      console.log("[Deliverables] Current effectiveId:", effectiveId, "Event subChatId:", data.subChatId)

      // Only process events for this sub-chat
      if (data.subChatId !== effectiveId) {
        console.log("[Deliverables] Ignoring event - subChatId mismatch")
        return
      }

      const { filePath, type } = data
      console.log("[Deliverables] Processing file change:", filePath, type)

      // Update deliverables list
      setDeliverables((prev) => {
        const existing = prev.find((d) => d.path === filePath)

        // Determine status based on tool type and existing state
        let status: Deliverable["status"] = "modified"
        if (type === "tool-Write") {
          // Write tool could be creating or modifying
          status = existing ? "modified" : "created"
        } else if (type === "tool-Edit") {
          status = "modified"
        }

        if (existing) {
          // Update existing entry
          return prev.map((d) =>
            d.path === filePath
              ? { ...d, status, timestamp: Date.now() }
              : d
          )
        } else {
          // Add new entry
          return [
            ...prev,
            {
              path: filePath,
              status,
              timestamp: Date.now(),
            },
          ]
        }
      })
    })

    return unsubscribe
  }, [effectiveId, setDeliverables])
}
