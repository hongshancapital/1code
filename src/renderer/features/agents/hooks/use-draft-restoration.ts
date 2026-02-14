import { useEffect, useRef } from "react"
import type { Editor } from "@/renderer/features/agents/ui/chat-input/prompt-input/lib/slate"
import { getSubChatDraftFull } from "../lib/drafts"

export interface UseDraftRestorationOptions {
  subChatId: string
  parentChatId: string | null
  editorRef: React.RefObject<Editor | null>
  setImagesFromDraft: (images: any[]) => void
  setFilesFromDraft: (files: any[]) => void
  setTextContextsFromDraft: (contexts: any[]) => void
  clearAll: () => void
  clearTextContexts: () => void
}

/**
 * Hook to restore draft content when switching between sub-chats.
 *
 * Restores:
 * - Text content
 * - Images
 * - Files
 * - Text contexts
 *
 * Clears everything when switching to a sub-chat with no saved draft.
 */
export function useDraftRestoration({
  subChatId,
  parentChatId,
  editorRef,
  setImagesFromDraft,
  setFilesFromDraft,
  setTextContextsFromDraft,
  clearAll,
  clearTextContexts,
}: UseDraftRestorationOptions): void {
  const prevSubChatIdForDraftRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function restoreDraft() {
      // Restore full draft (text + attachments + text contexts) for new sub-chat
      const savedDraft = parentChatId
        ? await getSubChatDraftFull(parentChatId, subChatId)
        : null

      if (cancelled) return

      if (savedDraft) {
        // Restore text
        if (savedDraft.text) {
          editorRef.current?.setValue(savedDraft.text)
        } else {
          editorRef.current?.clear()
        }
        // Restore images
        if (savedDraft.images.length > 0) {
          setImagesFromDraft(savedDraft.images)
        } else {
          clearAll()
        }
        // Restore files
        if (savedDraft.files.length > 0) {
          setFilesFromDraft(savedDraft.files)
        }
        // Restore text contexts
        if (savedDraft.textContexts.length > 0) {
          setTextContextsFromDraft(savedDraft.textContexts)
        } else {
          clearTextContexts()
        }
      } else if (
        prevSubChatIdForDraftRef.current &&
        prevSubChatIdForDraftRef.current !== subChatId
      ) {
        // Clear everything when switching to a sub-chat with no draft
        editorRef.current?.clear()
        clearAll()
        clearTextContexts()
      }

      prevSubChatIdForDraftRef.current = subChatId
    }

    restoreDraft()
    return () => {
      cancelled = true
    }
  }, [
    subChatId,
    parentChatId,
    setImagesFromDraft,
    setFilesFromDraft,
    setTextContextsFromDraft,
    clearAll,
    clearTextContexts,
  ])
}
