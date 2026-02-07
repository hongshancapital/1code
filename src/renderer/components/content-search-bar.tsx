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

interface SearchMatch {
  index: number
  node: Text
  start: number
  end: number
}

// ============================================================================
// SEARCH BAR COMPONENT
// ============================================================================

interface ContentSearchBarProps {
  /** Whether the search bar is open */
  isOpen: boolean
  /** Callback when search bar should close */
  onClose: () => void
  /** Optional class name for the search bar container */
  className?: string
  /** Reference to the scrollable container for searching and scrolling */
  scrollContainerRef: React.RefObject<HTMLElement | null>
}

/**
 * A search bar component for searching within rendered content.
 * Features:
 * - Real-time search highlighting using CSS Custom Highlight API (with fallback)
 * - Previous/Next navigation with keyboard shortcuts
 * - Scroll to current match
 * - Match count display
 */
export function ContentSearchBar({
  isOpen,
  onClose,
  className,
  scrollContainerRef,
}: ContentSearchBarProps) {
  const [inputValue, setInputValue] = useState("")
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [searchCompleted, setSearchCompleted] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightRef = useRef<Highlight | null>(null)
  const currentHighlightRef = useRef<Highlight | null>(null)

  // Check if CSS Custom Highlight API is supported
  const supportsHighlightAPI = typeof CSS !== "undefined" && "highlights" in CSS

  // Focus input when search opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen])

  // Clear highlights
  const clearHighlights = useCallback(() => {
    if (supportsHighlightAPI) {
      CSS.highlights.delete("content-search")
      CSS.highlights.delete("content-search-current")
    }
    highlightRef.current = null
    currentHighlightRef.current = null
  }, [supportsHighlightAPI])

  // Apply highlights using CSS Custom Highlight API
  const applyHighlights = useCallback(
    (searchMatches: SearchMatch[], currentIdx: number) => {
      clearHighlights()

      if (searchMatches.length === 0 || !supportsHighlightAPI) return

      const ranges: Range[] = []
      let currentRange: Range | null = null

      searchMatches.forEach((match, idx) => {
        try {
          const range = new Range()
          range.setStart(match.node, match.start)
          range.setEnd(match.node, match.end)

          if (idx === currentIdx) {
            currentRange = range
          } else {
            ranges.push(range)
          }
        } catch {
          // Range might be invalid if DOM changed
        }
      })

      // Create highlights
      if (ranges.length > 0) {
        const highlight = new Highlight(...ranges)
        CSS.highlights.set("content-search", highlight)
        highlightRef.current = highlight
      }

      if (currentRange) {
        const currentHighlight = new Highlight(currentRange)
        CSS.highlights.set("content-search-current", currentHighlight)
        currentHighlightRef.current = currentHighlight

        // Scroll to current match
        const rect = currentRange.getBoundingClientRect()
        const container = scrollContainerRef.current
        if (container && rect) {
          const containerRect = container.getBoundingClientRect()
          const isVisible =
            rect.top >= containerRect.top &&
            rect.bottom <= containerRect.bottom

          if (!isVisible) {
            // Calculate scroll position to center the match
            const scrollTop =
              container.scrollTop +
              (rect.top - containerRect.top) -
              containerRect.height / 2 +
              rect.height / 2

            container.scrollTo({
              top: scrollTop,
              behavior: "smooth",
            })
          }
        }
      }
    },
    [clearHighlights, scrollContainerRef, supportsHighlightAPI]
  )

  // Find text nodes and matches
  const findMatches = useCallback(
    (query: string): SearchMatch[] => {
      const container = scrollContainerRef.current
      if (!container || !query) return []

      const lowerQuery = query.toLowerCase()
      const foundMatches: SearchMatch[] = []

      // Walk through all text nodes
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null
      )

      let matchIndex = 0
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const text = node.textContent || ""
        const lowerText = text.toLowerCase()

        let searchStart = 0
        while (true) {
          const index = lowerText.indexOf(lowerQuery, searchStart)
          if (index === -1) break

          foundMatches.push({
            index: matchIndex++,
            node,
            start: index,
            end: index + query.length,
          })
          searchStart = index + 1
        }
      }

      return foundMatches
    },
    [scrollContainerRef]
  )

  // Debounced search
  useEffect(() => {
    setSearchCompleted(false)

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    debounceTimeoutRef.current = setTimeout(() => {
      const trimmedInput = inputValue.trim()

      if (!trimmedInput) {
        setMatches([])
        setCurrentIndex(0)
        setSearchCompleted(true)
        clearHighlights()
        return
      }

      const foundMatches = findMatches(trimmedInput)
      setMatches(foundMatches)
      setCurrentIndex(0)
      setSearchCompleted(true)
      applyHighlights(foundMatches, 0)
    }, 150)

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [inputValue, findMatches, applyHighlights, clearHighlights])

  // Clear state when closing
  useEffect(() => {
    if (!isOpen) {
      setInputValue("")
      setMatches([])
      setCurrentIndex(0)
      setSearchCompleted(false)
      clearHighlights()
    }
  }, [isOpen, clearHighlights])

  // Navigate to next match
  const goToNext = useCallback(() => {
    if (matches.length === 0) return
    const newIndex = (currentIndex + 1) % matches.length
    setCurrentIndex(newIndex)
    applyHighlights(matches, newIndex)
  }, [matches, currentIndex, applyHighlights])

  // Navigate to previous match
  const goToPrev = useCallback(() => {
    if (matches.length === 0) return
    const newIndex = currentIndex === 0 ? matches.length - 1 : currentIndex - 1
    setCurrentIndex(newIndex)
    applyHighlights(matches, newIndex)
  }, [matches, currentIndex, applyHighlights])

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

  if (!isOpen) return null

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-1.5",
        "bg-popover border border-border rounded-lg shadow-lg",
        "animate-in fade-in-0 slide-in-from-top-2 duration-150",
        "cursor-text",
        className
      )}
      onClick={handleContainerClick}
    >
      {/* Search icon */}
      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

      {/* Search input */}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
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
  )
}

// ============================================================================
// SEARCH TRIGGER BUTTON
// ============================================================================

interface ContentSearchTriggerProps {
  onClick: (e?: React.MouseEvent) => void
  className?: string
}

export function ContentSearchTrigger({
  onClick,
  className,
}: ContentSearchTriggerProps) {
  return (
    <button
      type="button"
      onClick={(e) => onClick(e)}
      className={cn(
        "h-6 w-6 flex items-center justify-center rounded-md cursor-pointer",
        "text-muted-foreground hover:text-foreground hover:bg-muted",
        "active:scale-95 transition-all duration-150 ease-out",
        className
      )}
      title="Search (⌘F)"
    >
      <Search className="h-3.5 w-3.5" />
    </button>
  )
}

// ============================================================================
// HOOK FOR SEARCH STATE
// ============================================================================

/**
 * Hook to manage content search state.
 * Returns state and handlers for the search bar.
 */
export function useContentSearchState() {
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  const openSearch = useCallback(() => setIsSearchOpen(true), [])
  const closeSearch = useCallback(() => setIsSearchOpen(false), [])
  const toggleSearch = useCallback(() => setIsSearchOpen((prev) => !prev), [])

  return {
    isSearchOpen,
    openSearch,
    closeSearch,
    toggleSearch,
  }
}
