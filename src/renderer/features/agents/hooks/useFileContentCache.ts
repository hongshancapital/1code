import { useCallback, useEffect, useRef } from "react"

/**
 * Hook for managing file content cache for mentions
 * Stores content for file mentions (keyed by mentionId) that gets added to the prompt when sending
 *
 * @param subChatId - Current sub-chat ID for cache isolation
 * @returns Object containing cache ref and utility functions
 */
export function useFileContentCache(subChatId: string) {
  // File contents cache - stores content for file mentions (keyed by mentionId)
  // This content gets added to the prompt when sending, without showing a separate card
  const fileContentsRef = useRef<Map<string, string>>(new Map())

  // Cache a file content for a specific mention
  const cacheFileContent = useCallback((mentionId: string, content: string) => {
    fileContentsRef.current.set(mentionId, content)
  }, [])

  // Get cached content for a mention
  const getCachedContent = useCallback((mentionId: string): string | undefined => {
    return fileContentsRef.current.get(mentionId)
  }, [])

  // Check if a mention has cached content
  const hasCachedContent = useCallback((mentionId: string): boolean => {
    return fileContentsRef.current.has(mentionId)
  }, [])

  // Remove cached content for a mention
  const removeCachedContent = useCallback((mentionId: string) => {
    fileContentsRef.current.delete(mentionId)
  }, [])

  // Clear all cached file contents
  const clearFileContents = useCallback(() => {
    fileContentsRef.current.clear()
  }, [])

  // Get all cached contents as an object
  const getAllCachedContents = useCallback((): Record<string, string> => {
    const result: Record<string, string> = {}
    fileContentsRef.current.forEach((content, mentionId) => {
      result[mentionId] = content
    })
    return result
  }, [])

  // Clear file contents cache when switching subChats to prevent stale data
  useEffect(() => {
    fileContentsRef.current.clear()
  }, [subChatId])

  return {
    fileContentsRef,
    cacheFileContent,
    getCachedContent,
    hasCachedContent,
    removeCachedContent,
    clearFileContents,
    getAllCachedContents,
  }
}
