"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ChevronDown, ChevronUp, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

// ============================================================================
// TYPES
// ============================================================================

export interface DiffFile {
  key: string
  diffText: string
  newPath: string
  oldPath: string
}

export interface SearchMatch {
  fileIndex: number
  fileKey: string
  filePath: string
  lineNumber: number
  lineContent: string
  matchStart: number
  matchEnd: number
}

export interface DiffSearchState {
  /** Current search query */
  query: string
  /** Current match being highlighted */
  currentMatch: SearchMatch | null
  /** All matches found */
  matches: SearchMatch[]
  /** Current match index */
  currentIndex: number
}

// ============================================================================
// DIFF SEARCH BAR COMPONENT
// ============================================================================

interface DiffSearchBarProps {
  /** Whether the search bar is open */
  isOpen: boolean
  /** Callback when search bar should close */
  onClose: () => void
  /** Optional class name for the search bar container */
  className?: string
  /** Diff files to search through */
  fileDiffs: DiffFile[]
  /** Callback to scroll to a specific file index */
  onScrollToFile: (fileIndex: number) => void
  /** Callback to expand a collapsed file */
  onExpandFile: (fileKey: string) => void
  /** Callback when search state changes (for highlighting in parent) */
  onSearchStateChange?: (state: DiffSearchState) => void
}

/**
 * A search bar component for searching within diff content.
 * Searches through diff text data and navigates via virtualizer.
 */
export function DiffSearchBar({
  isOpen,
  onClose,
  className,
  fileDiffs,
  onScrollToFile,
  onExpandFile,
  onSearchStateChange,
}: DiffSearchBarProps) {
  const [inputValue, setInputValue] = useState("")
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [searchCompleted, setSearchCompleted] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus input when search opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen])

  // Find matches in diff files
  const findMatches = useCallback(
    (query: string): SearchMatch[] => {
      if (!query || fileDiffs.length === 0) return []

      const lowerQuery = query.toLowerCase()
      const foundMatches: SearchMatch[] = []

      fileDiffs.forEach((file, fileIndex) => {
        const lines = file.diffText.split("\n")
        const filePath = file.newPath !== "/dev/null" ? file.newPath : file.oldPath

        lines.forEach((line, lineIndex) => {
          const lowerLine = line.toLowerCase()
          let searchStart = 0

          while (true) {
            const index = lowerLine.indexOf(lowerQuery, searchStart)
            if (index === -1) break

            foundMatches.push({
              fileIndex,
              fileKey: file.key,
              filePath,
              lineNumber: lineIndex + 1,
              lineContent: line,
              matchStart: index,
              matchEnd: index + query.length,
            })
            searchStart = index + 1
          }
        })
      })

      return foundMatches
    },
    [fileDiffs]
  )

  // Navigate to a match
  const navigateToMatch = useCallback(
    (match: SearchMatch) => {
      // Expand the file first
      onExpandFile(match.fileKey)
      // Delay scroll to allow React to update the DOM after expand
      // This ensures virtualizer has recalculated sizes before scrolling
      // Use multiple attempts to ensure scroll happens after virtualizer recalculates
      setTimeout(() => {
        onScrollToFile(match.fileIndex)
        // Second attempt after another frame for virtualizer to stabilize
        requestAnimationFrame(() => {
          onScrollToFile(match.fileIndex)
        })
      }, 100)
    },
    [onExpandFile, onScrollToFile]
  )

  // Notify parent of search state changes
  const notifySearchState = useCallback(
    (query: string, allMatches: SearchMatch[], idx: number) => {
      onSearchStateChange?.({
        query,
        currentMatch: allMatches[idx] || null,
        matches: allMatches,
        currentIndex: idx,
      })
    },
    [onSearchStateChange]
  )

  // Track previous input to avoid re-searching on same value
  const prevInputRef = useRef<string>("")

  // Debounced search - only depends on inputValue and findMatches
  // notifySearchState and navigateToMatch are called inside but not as deps
  // to avoid re-triggering search when parent re-renders
  useEffect(() => {
    setSearchCompleted(false)

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    debounceTimeoutRef.current = setTimeout(() => {
      const trimmedInput = inputValue.trim()

      // Skip if input hasn't changed (prevents reset on parent re-render)
      if (trimmedInput === prevInputRef.current) {
        setSearchCompleted(true)
        return
      }
      prevInputRef.current = trimmedInput

      if (!trimmedInput) {
        setMatches([])
        setCurrentIndex(0)
        setSearchCompleted(true)
        notifySearchState("", [], 0)
        return
      }

      const foundMatches = findMatches(trimmedInput)
      setMatches(foundMatches)
      setCurrentIndex(0)
      setSearchCompleted(true)
      notifySearchState(trimmedInput, foundMatches, 0)

      // Navigate to first match if found
      if (foundMatches.length > 0) {
        navigateToMatch(foundMatches[0])
      }
    }, 150)

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally exclude notifySearchState and navigateToMatch to prevent reset on parent re-render
  }, [inputValue, findMatches])

  // Clear state when closing
  useEffect(() => {
    if (!isOpen) {
      setInputValue("")
      setMatches([])
      setCurrentIndex(0)
      setSearchCompleted(false)
      prevInputRef.current = ""
      notifySearchState("", [], 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally exclude notifySearchState
  }, [isOpen])

  // Navigate to next match
  const goToNext = useCallback(() => {
    if (matches.length === 0) return
    const newIndex = (currentIndex + 1) % matches.length
    setCurrentIndex(newIndex)
    navigateToMatch(matches[newIndex])
    notifySearchState(inputValue.trim(), matches, newIndex)
  }, [matches, currentIndex, navigateToMatch, notifySearchState, inputValue])

  // Navigate to previous match
  const goToPrev = useCallback(() => {
    if (matches.length === 0) return
    const newIndex = currentIndex === 0 ? matches.length - 1 : currentIndex - 1
    setCurrentIndex(newIndex)
    navigateToMatch(matches[newIndex])
    notifySearchState(inputValue.trim(), matches, newIndex)
  }, [matches, currentIndex, navigateToMatch, notifySearchState, inputValue])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (e.shiftKey) {
          goToPrev()
        } else {
          goToNext()
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        goToNext()
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        goToPrev()
      }
    },
    [onClose, goToNext, goToPrev]
  )

  // Focus input when clicking on container
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest("button")) {
      inputRef.current?.focus()
    }
  }, [])

  const countInfo = useMemo(
    () => ({
      current: matches.length > 0 ? currentIndex + 1 : 0,
      total: matches.length,
    }),
    [matches.length, currentIndex]
  )

  // Current match info for display
  const currentMatch = matches[currentIndex]

  if (!isOpen) return null

  return (
    <div
      className={cn(
        "flex flex-col gap-1 px-2 py-1.5",
        "bg-popover border border-border rounded-lg shadow-lg",
        "animate-in fade-in-0 slide-in-from-top-2 duration-150",
        className
      )}
      onClick={handleContainerClick}
    >
      <div className="flex items-center gap-1 cursor-text">
        {/* Search icon */}
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search in diff..."
          className={cn(
            "flex-1 min-w-[80px] h-7 px-1.5 text-sm bg-transparent",
            "border-none outline-hidden",
            "placeholder:text-muted-foreground/60"
          )}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        {/* Results counter and navigation */}
        <div className="flex items-center gap-0.5 shrink-0">
          {countInfo.total > 0 ? (
            <>
              <span className="text-xs text-muted-foreground tabular-nums min-w-[50px] text-right">
                {countInfo.current} / {countInfo.total}
              </span>
              <button
                type="button"
                className="h-6 w-6 flex items-center justify-center rounded-md cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all duration-150 ease-out"
                onClick={() => {
                  goToPrev()
                  inputRef.current?.focus()
                }}
                title="Previous (Shift+Enter)"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="h-6 w-6 flex items-center justify-center rounded-md cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all duration-150 ease-out"
                onClick={() => {
                  goToNext()
                  inputRef.current?.focus()
                }}
                title="Next (Enter)"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </>
          ) : (
            inputValue.trim() &&
            searchCompleted && (
              <span className="text-xs text-muted-foreground">No results</span>
            )
          )}
        </div>

        {/* Close button */}
        <button
          type="button"
          className="h-6 w-6 shrink-0 flex items-center justify-center rounded-md cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all duration-150 ease-out"
          onClick={onClose}
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Current match context */}
      {currentMatch && (
        <div className="text-xs text-muted-foreground truncate px-1 border-t border-border/50 pt-1">
          <span className="font-medium text-foreground/80">
            {currentMatch.filePath.split("/").pop()}
          </span>
          <span className="mx-1">:</span>
          <span className="font-mono">{currentMatch.lineNumber}</span>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// HIGHLIGHT UTILITIES
// ============================================================================

/**
 * Apply CSS Custom Highlight API to highlight search matches in a container.
 * Works with both regular DOM and Shadow DOM.
 *
 * Note: CSS Custom Highlight API has limited support in Shadow DOM.
 * This function attempts to highlight text in both the light DOM and any
 * accessible Shadow DOM roots.
 */
export function applyDiffSearchHighlight(
  container: HTMLElement | null,
  query: string,
  highlightName = "diff-search"
): void {
  if (!container || !query) {
    clearDiffSearchHighlight(highlightName)
    return
  }

  const supportsHighlightAPI = typeof CSS !== "undefined" && "highlights" in CSS
  if (!supportsHighlightAPI) return

  const lowerQuery = query.toLowerCase()
  const ranges: Range[] = []

  // Helper to walk text nodes in a root
  const walkTextNodes = (root: Node | ShadowRoot) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const text = node.textContent || ""
      const lowerText = text.toLowerCase()

      let searchStart = 0
      while (true) {
        const index = lowerText.indexOf(lowerQuery, searchStart)
        if (index === -1) break

        try {
          const range = new Range()
          range.setStart(node, index)
          range.setEnd(node, index + query.length)
          ranges.push(range)
        } catch {
          // Range might be invalid
        }
        searchStart = index + 1
      }
    }
  }

  // Recursive helper to walk Shadow DOM
  const walkShadowRoots = (el: Element) => {
    // Check if this element has a shadow root
    if (el.shadowRoot) {
      walkTextNodes(el.shadowRoot)
      // Also check children within shadow root
      el.shadowRoot.querySelectorAll("*").forEach(walkShadowRoots)
    }
  }

  // Walk the main container
  walkTextNodes(container)

  // Walk all elements to find Shadow DOM roots
  container.querySelectorAll("*").forEach(walkShadowRoots)

  // Apply highlights
  CSS.highlights.delete(highlightName)
  if (ranges.length > 0) {
    const highlight = new Highlight(...ranges)
    CSS.highlights.set(highlightName, highlight)
  }
}

/**
 * Clear diff search highlights
 */
export function clearDiffSearchHighlight(highlightName = "diff-search"): void {
  if (typeof CSS !== "undefined" && "highlights" in CSS) {
    CSS.highlights.delete(highlightName)
    CSS.highlights.delete(`${highlightName}-current`)
  }
}

// ============================================================================
// HOOK FOR SEARCH STATE
// ============================================================================

const EMPTY_SEARCH_STATE: DiffSearchState = {
  query: "",
  currentMatch: null,
  matches: [],
  currentIndex: 0,
}

/**
 * Hook to manage diff search state.
 * Returns state and handlers for the search bar.
 */
export function useDiffSearchState() {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchState, setSearchState] = useState<DiffSearchState>(EMPTY_SEARCH_STATE)

  const openSearch = useCallback(() => setIsSearchOpen(true), [])
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false)
    setSearchState(EMPTY_SEARCH_STATE)
  }, [])
  const toggleSearch = useCallback(() => setIsSearchOpen((prev) => !prev), [])

  const handleSearchStateChange = useCallback((state: DiffSearchState) => {
    setSearchState(state)
  }, [])

  return {
    isSearchOpen,
    openSearch,
    closeSearch,
    toggleSearch,
    searchState,
    handleSearchStateChange,
  }
}
