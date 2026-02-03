"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { MessageSquare } from "lucide-react"
import { cn } from "../../../lib/utils"
import type { DocumentComment } from "../atoms/review-atoms"

interface CommentHighlightOverlayProps {
  /** Container element to search for text matches */
  containerRef: React.RefObject<HTMLElement | null>
  /** Comments to highlight */
  comments: DocumentComment[]
  /** Callback when clicking on a highlight, receives the icon's bounding rect */
  onHighlightClick?: (comment: DocumentComment, iconRect: DOMRect) => void
}

interface HighlightPosition {
  comment: DocumentComment
  rects: DOMRect[]
}

/**
 * Overlay component that renders highlight markers for commented text
 * Uses charStart and charLength from comment anchor to precisely locate text
 */
export function CommentHighlightOverlay({
  containerRef,
  comments,
  onHighlightClick,
}: CommentHighlightOverlayProps) {
  const [highlights, setHighlights] = useState<HighlightPosition[]>([])
  const observerRef = useRef<MutationObserver | null>(null)

  /**
   * Find text at specific character position in the container
   * Uses charStart to skip to the exact position, then highlights charLength characters
   */
  const findTextRectsAtPosition = useCallback((
    container: HTMLElement,
    charStart: number,
    charLength: number
  ): DOMRect[] => {
    const rects: DOMRect[] = []

    if (charStart < 0 || charLength <= 0) return rects

    // Use TreeWalker to find text nodes
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    )

    // Collect all text nodes with their character positions
    const textNodes: { node: Text; start: number; length: number }[] = []
    let totalLength = 0
    let node: Text | null

    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || ""
      textNodes.push({ node, start: totalLength, length: text.length })
      totalLength += text.length
    }

    // Calculate the end position
    const charEnd = charStart + charLength

    // Find which text nodes contain this range
    for (const { node, start, length } of textNodes) {
      const nodeEnd = start + length

      // Check if this node overlaps with our target range
      if (nodeEnd > charStart && start < charEnd) {
        // Calculate the range within this node
        const rangeStartInNode = Math.max(0, charStart - start)
        const rangeEndInNode = Math.min(length, charEnd - start)

        if (rangeStartInNode < rangeEndInNode) {
          try {
            const range = document.createRange()
            range.setStart(node, rangeStartInNode)
            range.setEnd(node, rangeEndInNode)

            const rangeRects = range.getClientRects()
            for (let i = 0; i < rangeRects.length; i++) {
              rects.push(rangeRects[i])
            }
          } catch (e) {
            // Ignore range errors (e.g., invalid offsets)
          }
        }
      }
    }

    return rects
  }, [])

  // Update highlight positions
  const updateHighlights = useCallback(() => {
    const container = containerRef.current
    if (!container || comments.length === 0) {
      setHighlights([])
      return
    }

    const containerRect = container.getBoundingClientRect()
    const newHighlights: HighlightPosition[] = []

    for (const comment of comments) {
      const { charStart, charLength } = comment.anchor

      // Use precise character position if available
      if (typeof charStart === "number" && typeof charLength === "number" && charStart >= 0 && charLength > 0) {
        const rects = findTextRectsAtPosition(container, charStart, charLength)
        if (rects.length > 0) {
          // Convert to relative positions
          const relativeRects = rects.map(rect => new DOMRect(
            rect.x - containerRect.x,
            rect.y - containerRect.y,
            rect.width,
            rect.height
          ))
          newHighlights.push({ comment, rects: relativeRects })
        }
      }
    }

    setHighlights(newHighlights)
  }, [containerRef, comments, findTextRectsAtPosition])

  // Observe container for changes and update highlights
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Initial update
    updateHighlights()

    // Observe for content changes
    observerRef.current = new MutationObserver(() => {
      // Debounce updates
      requestAnimationFrame(updateHighlights)
    })

    observerRef.current.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    // Also update on scroll/resize
    const scrollContainer = container.closest("[data-radix-scroll-area-viewport]") || container.parentElement
    const handleScroll = () => requestAnimationFrame(updateHighlights)
    scrollContainer?.addEventListener("scroll", handleScroll)
    window.addEventListener("resize", handleScroll)

    return () => {
      observerRef.current?.disconnect()
      scrollContainer?.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleScroll)
    }
  }, [containerRef, updateHighlights])

  // Re-update when comments change
  useEffect(() => {
    updateHighlights()
  }, [comments, updateHighlights])

  if (highlights.length === 0) return null

  return (
    <>
      {highlights.map(({ comment, rects }) => (
        <HighlightMarker
          key={comment.id}
          comment={comment}
          rects={rects}
          onClick={onHighlightClick}
        />
      ))}
    </>
  )
}

interface HighlightMarkerProps {
  comment: DocumentComment
  rects: DOMRect[]
  onClick?: (comment: DocumentComment, iconRect: DOMRect) => void
}

function HighlightMarker({ comment, rects, onClick }: HighlightMarkerProps) {
  const iconRef = useRef<HTMLButtonElement>(null)

  if (rects.length === 0) return null

  // Merge adjacent rects on the same line
  const mergedRects = mergeRects(rects)

  // Get the last rect for the comment icon position
  const lastRect = mergedRects[mergedRects.length - 1]

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onClick && iconRef.current) {
      // Use the icon's actual bounding rect for positioning the popup
      const iconRect = iconRef.current.getBoundingClientRect()
      onClick(comment, iconRect)
    }
  }

  return (
    <>
      {/* Highlight backgrounds */}
      {mergedRects.map((rect, index) => (
        <div
          key={`${comment.id}-bg-${index}`}
          className="absolute pointer-events-none bg-yellow-400/20 dark:bg-yellow-500/20"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}

      {/* Underline on last line */}
      {lastRect && (
        <div
          className="absolute pointer-events-none border-b-2 border-yellow-500/50 dark:border-yellow-400/50"
          style={{
            left: mergedRects[0].x,
            top: lastRect.y + lastRect.height - 2,
            width: lastRect.x + lastRect.width - mergedRects[0].x,
          }}
        />
      )}

      {/* Comment icon at the end */}
      {lastRect && (
        <button
          ref={iconRef}
          onClick={handleClick}
          className={cn(
            "absolute flex items-center justify-center",
            "w-4 h-4 rounded-full",
            "bg-yellow-500 dark:bg-yellow-400",
            "text-white dark:text-gray-900",
            "hover:scale-110 transition-transform",
            "cursor-pointer shadow-xs"
          )}
          style={{
            left: lastRect.x + lastRect.width + 4,
            top: lastRect.y + (lastRect.height - 16) / 2,
          }}
          title={`Comment: ${comment.content.slice(0, 50)}${comment.content.length > 50 ? "..." : ""}`}
        >
          <MessageSquare className="w-2.5 h-2.5" />
        </button>
      )}
    </>
  )
}

// Merge adjacent rects on the same line
function mergeRects(rects: DOMRect[]): DOMRect[] {
  if (rects.length <= 1) return rects

  const sorted = [...rects].sort((a, b) => {
    if (Math.abs(a.y - b.y) < 5) return a.x - b.x
    return a.y - b.y
  })

  const merged: DOMRect[] = []
  let current = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    // Same line (within 5px) and adjacent (within 5px gap)
    if (Math.abs(next.y - current.y) < 5 && next.x - (current.x + current.width) < 5) {
      // Extend current rect
      current = new DOMRect(
        current.x,
        Math.min(current.y, next.y),
        next.x + next.width - current.x,
        Math.max(current.height, next.height)
      )
    } else {
      merged.push(current)
      current = next
    }
  }
  merged.push(current)

  return merged
}
