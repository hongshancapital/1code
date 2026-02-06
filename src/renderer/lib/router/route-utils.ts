import type { NavigationRoute } from "./types"

/**
 * Build a route path string from a NavigationRoute.
 * Format: /{chatId}/{subChatId}/{messageId}?highlight={text}
 */
export function buildRoute(route: NavigationRoute): string {
  const parts = ["", route.chatId]
  if (route.subChatId) parts.push(route.subChatId)
  if (route.messageId) parts.push(route.messageId)

  let path = parts.join("/")
  if (route.highlight) {
    path += `?highlight=${encodeURIComponent(route.highlight)}`
  }
  return path
}

/**
 * Parse a route path string into a NavigationRoute.
 * Accepts: /{chatId}, /{chatId}/{subChatId}, /{chatId}/{subChatId}/{messageId}
 * Optional query: ?highlight={text}
 */
export function parseRoute(path: string): NavigationRoute | null {
  try {
    // Separate path and query
    const [pathPart, queryPart] = path.split("?")
    if (!pathPart) return null

    const segments = pathPart.split("/").filter(Boolean)
    if (segments.length === 0) return null

    const route: NavigationRoute = {
      chatId: segments[0]!,
      timestamp: Date.now(),
    }

    if (segments[1]) route.subChatId = segments[1]
    if (segments[2]) route.messageId = segments[2]

    if (queryPart) {
      const params = new URLSearchParams(queryPart)
      const highlight = params.get("highlight")
      if (highlight) route.highlight = highlight
    }

    return route
  } catch {
    return null
  }
}

/**
 * Build a deep link URL for the given route.
 * Format: hong://navigate/{chatId}/{subChatId}/{messageId}?highlight={text}
 */
export function buildDeepLink(route: NavigationRoute, protocol = "hong"): string {
  const routePath = buildRoute(route)
  return `${protocol}://navigate${routePath}`
}
