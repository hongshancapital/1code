/**
 * Memory Router types for in-app navigation.
 *
 * Route format: /{chatId}/{subChatId}/{messageId}?highlight={text}
 */

export interface NavigationRoute {
  chatId: string
  subChatId?: string
  messageId?: string
  highlight?: string
  /** Timestamp to distinguish repeated navigations to the same route */
  timestamp: number
}

export interface ScrollTarget {
  messageId: string
  highlight?: string
  /** Set to true after the scroll action has been performed */
  consumed: boolean
}
