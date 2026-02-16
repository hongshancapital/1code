import { useMemo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "../../../components/ui/context-menu"
import { Kbd } from "../../../components/ui/kbd"
import { isMac } from "../../../lib/utils"
import { isDesktopApp } from "../../../lib/utils/platform"
import type { SubChatMeta } from "../stores/sub-chat-store"
import { useResolvedHotkeyDisplay } from "../../../lib/hotkeys"
import { exportChat, copyChat, type ExportFormat } from "../lib/export-chat"
import { TagSelectorSubmenu } from "../../sidebar/components/tag-selector-submenu"

const openInNewWindow = (chatId: string, subChatId: string) => {
  window.desktopApi?.newWindow({ chatId, subChatId })
}

// Platform-aware keyboard shortcut for close tab
// Uses custom hotkey from settings if configured
const useCloseTabShortcut = () => {
  const archiveAgentHotkey = useResolvedHotkeyDisplay("archive-agent")
  return useMemo(() => {
    if (!isMac) return "Alt+Ctrl+W"
    return archiveAgentHotkey || "⌘W"
  }, [archiveAgentHotkey])
}

interface SubChatContextMenuProps {
  subChat: SubChatMeta
  isPinned: boolean
  onTogglePin: (subChatId: string) => void
  onRename: (subChat: SubChatMeta) => void
  onArchive: (subChatId: string) => void
  onArchiveOthers: (subChatId: string) => void
  onArchiveAllBelow?: (subChatId: string) => void
  isOnlyChat: boolean
  currentIndex?: number
  totalCount?: number
  showCloseTabOptions?: boolean
  onCloseTab?: (subChatId: string) => void
  onCloseOtherTabs?: (subChatId: string) => void
  onCloseTabsToRight?: (subChatId: string, visualIndex: number) => void
  visualIndex?: number
  hasTabsToRight?: boolean
  canCloseOtherTabs?: boolean
  /** Parent chat ID for export functionality */
  chatId?: string | null
  /** Current tag ID for this subchat (custom_xxx format or null) */
  currentTagId?: string | null
  /** Callback when tag is changed */
  onTagChange?: (subChatId: string, tagId: string | null) => void
  /** Callback to open manage tags dialog */
  onManageTags?: () => void
}

export function SubChatContextMenu({
  subChat,
  isPinned,
  onTogglePin,
  onRename,
  onArchive,
  onArchiveOthers,
  onArchiveAllBelow,
  isOnlyChat,
  currentIndex,
  totalCount,
  showCloseTabOptions = false,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  visualIndex = 0,
  hasTabsToRight = false,
  canCloseOtherTabs = false,
  chatId,
  currentTagId,
  onTagChange,
  onManageTags,
}: SubChatContextMenuProps) {
  const { t } = useTranslation("sidebar")
  const closeTabShortcut = useCloseTabShortcut()

  const handleExport = useCallback((format: ExportFormat) => {
    if (!chatId) return
    exportChat({ chatId, subChatId: subChat.id, format })
  }, [chatId, subChat.id])

  const handleCopy = useCallback((format: ExportFormat) => {
    if (!chatId) return
    copyChat({ chatId, subChatId: subChat.id, format })
  }, [chatId, subChat.id])

  return (
    <ContextMenuContent className="w-48">
      <ContextMenuItem onClick={() => onTogglePin(subChat.id)}>
        {isPinned ? t('chats.unpin') : t('chats.pin')}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onRename(subChat)}>
        {t('chats.rename')}
      </ContextMenuItem>
      {chatId && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t('chats.export.title')}</ContextMenuSubTrigger>
          <ContextMenuSubContent sideOffset={6} alignOffset={-4}>
            <ContextMenuItem onClick={() => handleExport("markdown")}>
              {t('chats.export.markdown')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleExport("json")}>
              {t('chats.export.json')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleExport("text")}>
              {t('chats.export.text')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleCopy("markdown")}>
              {t('chats.export.copyMarkdown')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleCopy("json")}>
              {t('chats.export.copyJson')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleCopy("text")}>
              {t('chats.export.copyText')}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {isDesktopApp() && chatId && (
        <ContextMenuItem onClick={() => openInNewWindow(chatId, subChat.id)}>
          {t('chats.openNewWindow')}
        </ContextMenuItem>
      )}
      {onTagChange && (
        <TagSelectorSubmenu
          currentTagId={currentTagId ?? null}
          onTagSelect={(tagId) => onTagChange(subChat.id, tagId)}
          onManageTags={onManageTags}
          hidePresetTags={true}
        />
      )}
      <ContextMenuSeparator />

      {showCloseTabOptions ? (
        <>
          <ContextMenuItem
            onClick={() => onCloseTab?.(subChat.id)}
            className="justify-between"
            disabled={isOnlyChat}
          >
            {t('chats.close')}
            {!isOnlyChat && <Kbd>{closeTabShortcut}</Kbd>}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onCloseOtherTabs?.(subChat.id)}
            disabled={!canCloseOtherTabs}
          >
            {t('chats.closeOthers')}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onCloseTabsToRight?.(subChat.id, visualIndex)}
            disabled={!hasTabsToRight}
          >
            {t('chats.closeRight')}
          </ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuItem
            onClick={() => onArchive(subChat.id)}
            className="justify-between"
            disabled={isOnlyChat}
          >
            {t('chats.archive')}
            {!isOnlyChat && <Kbd>{closeTabShortcut}</Kbd>}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onArchiveAllBelow?.(subChat.id)}
            disabled={
              currentIndex === undefined ||
              currentIndex >= (totalCount || 0) - 1
            }
          >
            {t('chats.archiveBelow')}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onArchiveOthers(subChat.id)}
            disabled={isOnlyChat}
          >
            {t('chats.archiveOthers')}
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )
}
