"use client"

import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Folder, ArrowRight, Loader2 } from "lucide-react"
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
  const [targetPath, setTargetPath] = useState<string | null>(null)
  const [newName, setNewName] = useState(projectName || "")
  const [isPickingFolder, setIsPickingFolder] = useState(false)

  const utils = trpc.useUtils()

  const pickDestination = trpc.projects.pickMigrateDestination.useMutation({
    onSuccess: (result) => {
      if (result.success && result.targetPath) {
        setTargetPath(result.targetPath)
      }
    },
  })

  const migratePlayground = trpc.projects.migratePlayground.useMutation({
    onSuccess: () => {
      toast.success(t("moveToWorkspace.success"))
      // Invalidate queries to refresh the UI
      utils.projects.list.invalidate()
      utils.chats.list.invalidate()
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
    setTargetPath(null)
    setNewName(projectName || "")
    onOpenChange(false)
  }, [projectName, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("moveToWorkspace.title")}</DialogTitle>
          <DialogDescription>
            {t("moveToWorkspace.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
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
                className="flex-1 justify-start text-left font-normal"
                onClick={handlePickFolder}
                disabled={isPickingFolder}
              >
                {isPickingFolder ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Folder className="h-4 w-4 mr-2" />
                )}
                {targetPath ? (
                  <span className="truncate">{targetPath}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {t("moveToWorkspace.selectFolder")}
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Preview */}
          {targetPath && (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="truncate">{projectName}</span>
                <ArrowRight className="h-4 w-4 shrink-0" />
                <span className="truncate font-medium text-foreground">
                  {targetPath}
                </span>
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
