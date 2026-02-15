/**
 * useFileContentsCache - File contents cache for @mention references
 *
 * Maintains a map of mentionId → file content that gets added to the prompt
 * when sending, without showing a separate card. Clears on sub-chat switch.
 */

import { useCallback, useEffect, useRef } from "react"

export interface UseFileContentsCacheOptions {
  subChatId: string
}

export interface UseFileContentsCacheResult {
  fileContentsRef: React.RefObject<Map<string, string>>
  cacheFileContent: (mentionId: string, content: string) => void
  clearFileContents: () => void
}

export function useFileContentsCache({
  subChatId,
}: UseFileContentsCacheOptions): UseFileContentsCacheResult {
  const fileContentsRef = useRef<Map<string, string>>(new Map())

  const cacheFileContent = useCallback((mentionId: string, content: string) => {
    fileContentsRef.current.set(mentionId, content)
  }, [])

  const clearFileContents = useCallback(() => {
    fileContentsRef.current.clear()
  }, [])

  // Clear cache when switching subChats to prevent stale data
  useEffect(() => {
    fileContentsRef.current.clear()
  }, [subChatId])

  return { fileContentsRef, cacheFileContent, clearFileContents }
}
