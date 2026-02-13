"use client"

import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Folder, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { trpc } from "../../lib/trpc"
import { toast } from "sonner"

interface MoveToWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
  onSuccess?: () => void
}

export function MoveToWorkspaceDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  onSuccess,
}: MoveToWorkspaceDialogProps) {
  const { t } = useTranslation("common")
  const [parentDir, setParentDir] = useState<string | null>(null)
  const [newName, setNewName] = useState(projectName || "")
  const [isPickingFolder, setIsPickingFolder] = useState(false)

  // targetPath is computed from parentDir + newName, always in sync
  const targetPath = parentDir && newName ? `${parentDir}/${newName}` : null

  const utils = trpc.useUtils()

  const pickDestination = trpc.projects.pickMigrateDestination.useMutation({
    onSuccess: (result) => {
      if (result.success && result.parentDir) {
        setParentDir(result.parentDir)
      }
    },
  })

  const migratePlayground = trpc.projects.migratePlayground.useMutation({
    onSuccess: () => {
      toast.success(t("moveToWorkspace.success"))
      // Invalidate queries to refresh the UI
      utils.projects.list.invalidate()
      utils.chats.list.invalidate()
      utils.chats.get.invalidate()
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (error) => {
      toast.error(error.message || t("moveToWorkspace.error"))
    },
  })

  const handlePickFolder = useCallback(async () => {
    setIsPickingFolder(true)
    try {
      await pickDestination.mutateAsync({ suggestedName: newName || "my-project" })
    } finally {
      setIsPickingFolder(false)
    }
  }, [pickDestination, newName])

  const handleMove = useCallback(() => {
    if (!targetPath) return
    migratePlayground.mutate({
      projectId,
      targetPath,
      newName: newName || undefined,
    })
  }, [projectId, targetPath, newName, migratePlayground])

  const handleClose = useCallback(() => {
    setParentDir(null)
    setNewName(projectName || "")
    onOpenChange(false)
  }, [projectName, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("moveToWorkspace.title")}</DialogTitle>
          <DialogDescription>
            {t("moveToWorkspace.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 min-w-0">
          {/* Project name input */}
          <div className="space-y-2">
            <Label htmlFor="project-name">{t("moveToWorkspace.projectName")}</Label>
            <Input
              id="project-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("moveToWorkspace.projectNamePlaceholder")}
            />
          </div>

          {/* Target folder selection */}
          <div className="space-y-2">
            <Label>{t("moveToWorkspace.targetFolder")}</Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 justify-start text-left font-normal min-w-0 overflow-hidden"
                onClick={handlePickFolder}
                disabled={isPickingFolder}
              >
                {isPickingFolder ? (
                  <Loader2 className="h-4 w-4 mr-2 shrink-0 animate-spin" />
                ) : (
                  <Folder className="h-4 w-4 mr-2 shrink-0" />
                )}
                {parentDir ? (
                  <span className="truncate">{parentDir}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {t("moveToWorkspace.selectFolder")}
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Final path preview */}
          {targetPath && (
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">{t("moveToWorkspace.finalPath")}</Label>
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm font-mono truncate">
                {targetPath}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleMove}
            disabled={!targetPath || migratePlayground.isPending}
          >
            {migratePlayground.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("moveToWorkspace.moving")}
              </>
            ) : (
              t("moveToWorkspace.move")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
