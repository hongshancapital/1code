"use client"

import { memo, useCallback } from "react"
import { useAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { Layers, List, FolderTree, Tags } from "lucide-react"
import { Button } from "../../../components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "../../../components/ui/dropdown-menu"
import {
  workspaceGroupedViewAtom,
  workspaceGroupModeAtom,
  type WorkspaceGroupMode,
} from "../../../lib/atoms"
import { cn } from "../../../lib/utils"

interface GroupingToggleProps {
  className?: string
}

export const GroupingToggle = memo(function GroupingToggle({
  className,
}: GroupingToggleProps) {
  const { t } = useTranslation("sidebar")
  const [isGrouped, setIsGrouped] = useAtom(workspaceGroupedViewAtom)
  const [groupMode, setGroupMode] = useAtom(workspaceGroupModeAtom)

  const handleToggle = useCallback(
    (e: Event) => {
      // Prevent menu from closing when enabling grouped view
      // so user can continue to select group mode
      if (!isGrouped) {
        e.preventDefault()
      }
      setIsGrouped(!isGrouped)
    },
    [isGrouped, setIsGrouped],
  )

  const handleModeChange = useCallback(
    (mode: string) => {
      setGroupMode(mode as WorkspaceGroupMode)
    },
    [setGroupMode],
  )

  return (
    <DropdownMenu>
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", className)}
            >
              {isGrouped ? (
                <Layers className="h-4 w-4" />
              ) : (
                <List className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isGrouped ? t("grouping.disable") : t("grouping.enable")}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={handleToggle}>
          {isGrouped ? (
            <>
              <List className="h-4 w-4 mr-2" />
              {t("grouping.disable")}
            </>
          ) : (
            <>
              <Layers className="h-4 w-4 mr-2" />
              {t("grouping.enable")}
            </>
          )}
        </DropdownMenuItem>

        {isGrouped && (
          <>
            <DropdownMenuSeparator />

            <DropdownMenuRadioGroup
              value={groupMode}
              onValueChange={handleModeChange}
            >
              <DropdownMenuRadioItem value="folder">
                <FolderTree className="h-4 w-4 mr-2" />
                {t("grouping.byFolder")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="tag">
                <Tags className="h-4 w-4 mr-2" />
                {t("grouping.byTag")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
