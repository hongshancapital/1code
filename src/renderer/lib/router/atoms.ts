import { atom } from "jotai"
import type { NavigationRoute, ScrollTarget } from "./types"

/** Current navigation route (null = new chat / home view) */
export const currentRouteAtom = atom<NavigationRoute | null>(null)

/**
 * One-shot scroll target — consumed by useScrollToTarget after scrolling.
 * Separated from currentRouteAtom because scroll is a side-effect, not state.
 */
export const scrollTargetAtom = atom<ScrollTarget | null>(null)

/**
 * Flag set by navigateTo() before it async-resolves the project from chat data.
 * When true, the sidebar's "reset chatId on project change" effect should skip,
 * because the project change was triggered by chat navigation (not by the user
 * manually switching projects via the project selector).
 *
 * Stores the ID of the project being navigated to.
 */
export const navigatedProjectIdAtom = atom<string | null>(null)
