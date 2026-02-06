import { atom } from "jotai"
import type { NavigationRoute, ScrollTarget } from "./types"

/** Current navigation route (null = new chat / home view) */
export const currentRouteAtom = atom<NavigationRoute | null>(null)

/**
 * One-shot scroll target — consumed by useScrollToTarget after scrolling.
 * Separated from currentRouteAtom because scroll is a side-effect, not state.
 */
export const scrollTargetAtom = atom<ScrollTarget | null>(null)
