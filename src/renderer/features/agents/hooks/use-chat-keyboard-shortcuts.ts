/**
 * useChatKeyboardShortcuts - Unified keyboard shortcuts for chat operations
 *
 * This hook consolidates keyboard shortcut handling that was previously
 * scattered across multiple useEffect blocks in active-chat.tsx.
 *
 * Shortcuts handled:
 * - Cmd+T (Desktop) / Opt+Cmd+T (Web): New sub-chat
 * - Cmd+W (Desktop) / Opt+Cmd+W (Web): Close sub-chat
 * - Cmd+[ / Cmd+] (Desktop) / Opt+Cmd+[ / Opt+Cmd+] (Web): Navigate sub-chats
 * - Cmd+D: Toggle diff sidebar
 * - Cmd+Shift+E: Restore archived workspace
 *
 * Usage:
 *   useChatKeyboardShortcuts({
 *     onNewSubChat: handleCreateNewSubChat,
 *     onCloseSubChat: handleCloseSubChat,
 *     onToggleDiffSidebar: () => setDiffOpen(prev => !prev),
 *     onRestoreWorkspace: handleRestore,
 *     isArchived,
 *   })
 */

import { useEffect, useCallback } from "react"
import { useSetAtom } from "jotai"
import { usePlatform } from "../../../contexts/PlatformContext"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { undoStackAtom } from "../atoms"

export interface ChatKeyboardShortcutsOptions {
  // Chat ID for undo stack
  chatId: string

  // Callbacks
  onNewSubChat?: () => void
  onToggleDiffSidebar?: () => void
  onRestoreWorkspace?: () => void

  // State
  isDiffSidebarOpen?: boolean
  isArchived?: boolean
  isRestoringWorkspace?: boolean

  // Multi-select state (for bulk close)
  isSubChatMultiSelectMode?: boolean
  selectedSubChatIds?: Set<string>
  clearSubChatSelection?: () => void
}

export function useChatKeyboardShortcuts({
  chatId,
  onNewSubChat,
  onToggleDiffSidebar,
  onRestoreWorkspace,
  isDiffSidebarOpen = false,
  isArchived = false,
  isRestoringWorkspace = false,
  isSubChatMultiSelectMode = false,
  selectedSubChatIds = new Set(),
  clearSubChatSelection,
}: ChatKeyboardShortcutsOptions): void {
  const { isDesktop } = usePlatform()
  const setUndoStack = useSetAtom(undoStackAtom)

  // Helper to add sub-chat to undo stack
  const addSubChatToUndoStack = useCallback(
    (subChatId: string) => {
      const timeoutId = setTimeout(() => {
        setUndoStack((prev) =>
          prev.filter(
            (item) => !(item.type === "subchat" && item.subChatId === subChatId)
          )
        )
      }, 10000)

      setUndoStack((prev) => [
        ...prev,
        {
          type: "subchat",
          subChatId,
          chatId,
          timeoutId,
        },
      ])
    },
    [chatId, setUndoStack]
  )

  // Keyboard shortcut: New sub-chat (Cmd+T / Opt+Cmd+T)
  useEffect(() => {
    if (!onNewSubChat) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const isDesktopPlatform = isDesktop

      // Desktop: Cmd+T (without Alt)
      if (isDesktopPlatform && e.metaKey && e.code === "KeyT" && !e.altKey) {
        e.preventDefault()
        onNewSubChat()
        return
      }

      // Web: Opt+Cmd+T (with Alt)
      if (e.altKey && e.metaKey && e.code === "KeyT") {
        e.preventDefault()
        onNewSubChat()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onNewSubChat, isDesktop])

  // Keyboard shortcut: Close sub-chat (Cmd+W / Opt+Cmd+W)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isDesktopPlatform = isDesktop

      // Desktop: Cmd+W (without Alt)
      const isDesktopShortcut =
        isDesktopPlatform &&
        e.metaKey &&
        e.code === "KeyW" &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey

      // Web: Opt+Cmd+W (with Alt)
      const isWebShortcut = e.altKey && e.metaKey && e.code === "KeyW"

      if (isDesktopShortcut || isWebShortcut) {
        e.preventDefault()

        const store = useAgentSubChatStore.getState()

        // If multi-select mode, bulk close selected sub-chats
        if (isSubChatMultiSelectMode && selectedSubChatIds.size > 0) {
          const idsToClose = Array.from(selectedSubChatIds)
          const remainingOpenIds = store.openSubChatIds.filter(
            (id) => !idsToClose.includes(id)
          )

          // Don't close all tabs via hotkey
          if (remainingOpenIds.length > 0) {
            idsToClose.forEach((id) => {
              store.removeFromOpenSubChats(id)
              addSubChatToUndoStack(id)
            })
          }
          clearSubChatSelection?.()
          return
        }

        // Otherwise close active sub-chat
        const activeId = store.activeSubChatId
        const openIds = store.openSubChatIds

        // Only close if we have more than one tab open
        if (activeId && openIds.length > 1) {
          store.removeFromOpenSubChats(activeId)
          addSubChatToUndoStack(activeId)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    isSubChatMultiSelectMode,
    selectedSubChatIds,
    clearSubChatSelection,
    addSubChatToUndoStack,
    isDesktop,
  ])

  // Keyboard shortcut: Navigate between sub-chats (Cmd+[ / Cmd+])
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isDesktopPlatform = isDesktop

      // Check for previous sub-chat shortcut ([ key)
      const isPrevDesktop =
        isDesktopPlatform &&
        e.metaKey &&
        e.code === "BracketLeft" &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey
      const isPrevWeb = e.altKey && e.metaKey && e.code === "BracketLeft"

      if (isPrevDesktop || isPrevWeb) {
        e.preventDefault()

        const store = useAgentSubChatStore.getState()
        const activeId = store.activeSubChatId
        const openIds = store.openSubChatIds

        if (openIds.length <= 1) return

        if (!activeId) {
          store.setActiveSubChat(openIds[0])
          return
        }

        const currentIndex = openIds.indexOf(activeId)
        if (currentIndex === -1) {
          store.setActiveSubChat(openIds[0])
          return
        }

        const nextIndex =
          currentIndex - 1 < 0 ? openIds.length - 1 : currentIndex - 1
        const nextId = openIds[nextIndex]
        if (nextId) {
          store.setActiveSubChat(nextId)
        }
      }

      // Check for next sub-chat shortcut (] key)
      const isNextDesktop =
        isDesktopPlatform &&
        e.metaKey &&
        e.code === "BracketRight" &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey
      const isNextWeb = e.altKey && e.metaKey && e.code === "BracketRight"

      if (isNextDesktop || isNextWeb) {
        e.preventDefault()

        const store = useAgentSubChatStore.getState()
        const activeId = store.activeSubChatId
        const openIds = store.openSubChatIds

        if (openIds.length <= 1) return

        if (!activeId) {
          store.setActiveSubChat(openIds[0])
          return
        }

        const currentIndex = openIds.indexOf(activeId)
        if (currentIndex === -1) {
          store.setActiveSubChat(openIds[0])
          return
        }

        const nextIndex = (currentIndex + 1) % openIds.length
        const nextId = openIds[nextIndex]
        if (nextId) {
          store.setActiveSubChat(nextId)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isDesktop])

  // Keyboard shortcut: Toggle diff sidebar (Cmd+D)
  useEffect(() => {
    if (!onToggleDiffSidebar) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey &&
        e.code === "KeyD"
      ) {
        e.preventDefault()
        e.stopPropagation()
        onToggleDiffSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [onToggleDiffSidebar])

  // Keyboard shortcut: Restore archived workspace (Cmd+Shift+E)
  useEffect(() => {
    if (!onRestoreWorkspace) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.metaKey &&
        e.shiftKey &&
        !e.altKey &&
        !e.ctrlKey &&
        e.code === "KeyE"
      ) {
        if (isArchived && !isRestoringWorkspace) {
          e.preventDefault()
          e.stopPropagation()
          onRestoreWorkspace()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isArchived, isRestoringWorkspace, onRestoreWorkspace])
}
