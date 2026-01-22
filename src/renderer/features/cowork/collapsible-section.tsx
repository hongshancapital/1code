import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "../../lib/utils"

// ============================================================================
// Types
// ============================================================================

interface CollapsibleSectionProps {
  title: string
  icon: React.ReactNode
  badge?: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
  className?: string
}

// ============================================================================
// Component
// ============================================================================

export function CollapsibleSection({
  title,
  icon,
  badge,
  isExpanded,
  onToggle,
  children,
  className,
}: CollapsibleSectionProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header - always visible */}
      <button
        className="flex items-center justify-between px-3 py-2 border-b hover:bg-accent/50 transition-colors w-full text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          {/* Icon */}
          {icon}
          {/* Title */}
          <span className="text-xs font-medium">{title}</span>
          {/* Badge (count, etc.) */}
          {badge}
        </div>
        {/* Expand/Collapse chevron - on the right */}
        <span className="flex-shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
      </button>

      {/* Content - only when expanded */}
      {isExpanded && (
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  )
}
