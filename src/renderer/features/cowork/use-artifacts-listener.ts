import { useEffect, useMemo } from "react"
import { useSetAtom } from "jotai"
import { artifactsAtomFamily, type Artifact, type ArtifactContext } from "./atoms"

/**
 * Hook to listen for file-changed events from Claude tools
 * and automatically add them to the artifacts list for the current sub-chat
 */
export function useArtifactsListener(subChatId: string | null) {
  const effectiveId = subChatId || "default"
  const artifactsAtom = useMemo(
    () => artifactsAtomFamily(effectiveId),
    [effectiveId]
  )
  const setArtifacts = useSetAtom(artifactsAtom)

  useEffect(() => {
    if (!window.desktopApi?.onFileChanged) {
      console.log("[Artifacts] onFileChanged not available")
      return
    }

    console.log("[Artifacts] Listening for file changes, subChatId:", effectiveId)

    const unsubscribe = window.desktopApi.onFileChanged((data) => {
      console.log("[Artifacts] Received file-changed event:", data)
      console.log("[Artifacts] Current effectiveId:", effectiveId, "Event subChatId:", data.subChatId)

      // Only process events for this sub-chat
      if (data.subChatId !== effectiveId) {
        console.log("[Artifacts] Ignoring event - subChatId mismatch")
        return
      }

      const { filePath, type, contexts } = data as {
        filePath: string
        type: string
        subChatId: string
        contexts?: ArtifactContext[]
      }
      console.log("[Artifacts] Processing file change:", filePath, type, "contexts:", contexts?.length ?? 0)

      // Update artifacts list
      setArtifacts((prev) => {
        const existing = prev.find((d) => d.path === filePath)

        // Determine status based on tool type and existing state
        let status: Artifact["status"] = "modified"
        if (type === "tool-Write") {
          // Write tool could be creating or modifying
          status = existing ? "modified" : "created"
        } else if (type === "tool-Edit") {
          status = "modified"
        }

        if (existing) {
          // Update existing entry, merge contexts
          return prev.map((d) =>
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
          return [
            ...prev,
            {
              path: filePath,
              status,
              timestamp: Date.now(),
              contexts: contexts || [],
            },
          ]
        }
      })
    })

    return unsubscribe
  }, [effectiveId, setArtifacts])
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
