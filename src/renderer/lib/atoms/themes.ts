import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// Full VS Code theme data type
export type VSCodeFullTheme = {
  id: string
  name: string
  type: "light" | "dark"
  colors: Record<string, string>
  tokenColors?: any[]
  semanticHighlighting?: boolean
  semanticTokenColors?: Record<string, any>
  source: "builtin" | "imported" | "discovered"
  path?: string
}

// Selected full theme ID (null = use system default)
export const selectedFullThemeIdAtom = atomWithStorage<string | null>(
  "preferences:selected-full-theme-id",
  null,
  undefined,
  { getOnInit: true },
)

// Theme to use when system is in light mode
export const systemLightThemeIdAtom = atomWithStorage<string>(
  "preferences:system-light-theme-id",
  "hs-light",
  undefined,
  { getOnInit: true },
)

// Theme to use when system is in dark mode
export const systemDarkThemeIdAtom = atomWithStorage<string>(
  "preferences:system-dark-theme-id",
  "hs-dark",
  undefined,
  { getOnInit: true },
)

// Cached full theme data for the selected theme
export const fullThemeDataAtom = atom<VSCodeFullTheme | null>(null)

// Imported themes from VS Code extensions
export const importedThemesAtom = atomWithStorage<VSCodeFullTheme[]>(
  "preferences:imported-themes",
  [],
  undefined,
  { getOnInit: true },
)

// All available full themes (built-in + imported + discovered)
export const allFullThemesAtom = atom<VSCodeFullTheme[]>((_get) => {
  return []
})
