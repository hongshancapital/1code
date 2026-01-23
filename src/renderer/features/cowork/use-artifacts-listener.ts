import { useEffect } from "react"
import { useStore } from "jotai"
import { artifactsAtomFamily, type Artifact, type ArtifactContext } from "./atoms"

/**
 * Hook to listen for file-changed events from Claude tools
 * and automatically add them to the artifacts list for the correct session
 *
 * Uses subChatId from the event to store artifacts in the correct session.
 * The parameter is only used for logging/debugging.
 */
export function useArtifactsListener(currentSubChatId: string | null) {
  const store = useStore()

  useEffect(() => {
    if (!window.desktopApi?.onFileChanged) {
      console.log("[Artifacts] onFileChanged not available")
      return
    }

    console.log("[Artifacts] Setting up file change listener, currentSubChatId:", currentSubChatId)

    const unsubscribe = window.desktopApi.onFileChanged((data) => {
      const { filePath, type, subChatId: eventSubChatId, contexts } = data as {
        filePath: string
        type: string
        subChatId: string
        contexts?: ArtifactContext[]
      }

      // Use the subChatId from the event, fallback to "default"
      const targetSubChatId = eventSubChatId || "default"

      console.log("[Artifacts] Processing file change:", filePath, "type:", type, "targetSubChatId:", targetSubChatId)

      // Get the atom for the target subChatId
      const artifactsAtom = artifactsAtomFamily(targetSubChatId)

      // Update artifacts using store.set with updater function
      // This ensures the atomFamily's custom setter is triggered properly
      store.set(artifactsAtom, (prev: Artifact[]) => {
        const existing = prev.find((d) => d.path === filePath)

        // Determine status based on tool type and existing state
        let status: Artifact["status"] = "modified"
        if (type === "tool-Write" || type === "tool-MarkArtifact") {
          // Write tool and MarkArtifact could be creating or modifying
          status = existing ? "modified" : "created"
        } else if (type === "tool-Edit") {
          status = "modified"
        }

        let newArtifacts: Artifact[]
        if (existing) {
          // Update existing entry, merge contexts
          newArtifacts = prev.map((d) =>
            d.path === filePath
              ? {
                  ...d,
                  status,
                  timestamp: Date.now(),
                  contexts: mergeContexts(d.contexts, contexts),
                }
              : d
          )
        } else {
          // Add new entry
          newArtifacts = [
            ...prev,
            {
              path: filePath,
              status,
              timestamp: Date.now(),
              contexts: contexts || [],
            },
          ]
        }

        console.log("[Artifacts] Updated artifacts for subChatId:", targetSubChatId, "count:", newArtifacts.length)
        return newArtifacts
      })
    })

    return () => {
      console.log("[Artifacts] Cleaning up file change listener")
      unsubscribe()
    }
  }, [store, currentSubChatId])
}

/**
 * Merge existing contexts with new contexts, avoiding duplicates
 */
function mergeContexts(
  existing: ArtifactContext[] | undefined,
  incoming: ArtifactContext[] | undefined
): ArtifactContext[] {
  if (!incoming || incoming.length === 0) {
    return existing || []
  }
  if (!existing || existing.length === 0) {
    return incoming
  }

  const merged = [...existing]

  for (const ctx of incoming) {
    const isDuplicate = merged.some((e) => {
      if (e.type !== ctx.type) return false
      if (e.type === "file") return e.filePath === ctx.filePath
      if (e.type === "url") return e.url === ctx.url
      return false
    })

    if (!isDuplicate) {
      merged.push(ctx)
    }
  }

  return merged
}
