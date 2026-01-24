import { ChevronDown } from "lucide-react"
import { useState } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../ui/collapsible"
import { Badge } from "../../ui/badge"
import { cn } from "../../../lib/utils"

// ============================================================================
// Types
// ============================================================================

interface RuntimeSectionProps {
  /** Unique identifier for the section */
  id: string
  /** Icon to display in the header */
  icon: React.ReactNode
  /** Section title */
  title: string
  /** Optional description shown below title */
  description?: string
  /** Whether the section is disabled (e.g., coming soon) */
  disabled?: boolean
  /** Default expanded state */
  defaultOpen?: boolean
  /** Section content */
  children: React.ReactNode
}

// ============================================================================
// Component
// ============================================================================

export function RuntimeSection({
  id,
  icon,
  title,
  description,
  disabled = false,
  defaultOpen = true,
  children,
}: RuntimeSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen && !disabled)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={disabled ? undefined : setIsOpen}
      className="border border-border rounded-lg overflow-hidden"
    >
      <CollapsibleTrigger
        className={cn(
          "flex items-center justify-between w-full px-4 py-3 text-left transition-colors",
          "hover:bg-muted/50",
          disabled && "cursor-not-allowed opacity-60"
        )}
        disabled={disabled}
      >
        <div className="flex items-center gap-3">
          <div className="text-muted-foreground">{icon}</div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{title}</span>
              {disabled && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Coming soon
                </Badge>
              )}
            </div>
            {description && (
              <span className="text-xs text-muted-foreground">{description}</span>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4 pt-2 border-t border-border/50">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ============================================================================
// Sub-section Component (for grouping within a RuntimeSection)
// ============================================================================

interface RuntimeSubSectionProps {
  /** Section title */
  title: string
  /** Section content */
  children: React.ReactNode
}

export function RuntimeSubSection({ title, children }: RuntimeSubSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        <div className="flex-1 h-px bg-border/50" />
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
