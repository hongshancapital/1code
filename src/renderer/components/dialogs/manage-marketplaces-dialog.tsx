/**
 * Manage Marketplaces Dialog
 *
 * Dialog for adding, updating, and removing plugin marketplaces.
 */

import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { trpc } from "../../lib/trpc"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import {
  RefreshCw,
  Trash2,
  Plus,
  Loader2,
  Star,
  ExternalLink,
  AlertCircle,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "../../lib/utils"

interface ManageMarketplacesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ManageMarketplacesDialog({
  open,
  onOpenChange,
}: ManageMarketplacesDialogProps) {
  const { t } = useTranslation("settings")
  const [newGitUrl, setNewGitUrl] = useState("")
  const [isAdding, setIsAdding] = useState(false)
  const [updatingMarketplace, setUpdatingMarketplace] = useState<string | null>(null)

  const {
    data: marketplaces = [],
    isLoading,
    refetch,
  } = trpc.marketplace.listMarketplaces.useQuery(undefined, {
    enabled: open,
  })

  const addMutation = trpc.marketplace.addMarketplace.useMutation()
  const updateMutation = trpc.marketplace.updateMarketplace.useMutation()
  const removeMutation = trpc.marketplace.removeMarketplace.useMutation()
  const initOfficialMutation = trpc.marketplace.initializeOfficial.useMutation()

  const utils = trpc.useUtils()

  const handleAdd = useCallback(async () => {
    if (!newGitUrl.trim()) return

    setIsAdding(true)
    try {
      await addMutation.mutateAsync({ gitUrl: newGitUrl.trim() })
      toast.success(t("marketplace.toast.added"))
      setNewGitUrl("")
      await refetch()
      await utils.marketplace.listAvailablePlugins.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("marketplace.toast.addFailed")
      )
    } finally {
      setIsAdding(false)
    }
  }, [newGitUrl, addMutation, refetch, utils, t])

  const handleUpdate = useCallback(
    async (name: string) => {
      setUpdatingMarketplace(name)
      try {
        await updateMutation.mutateAsync({ name })
        toast.success(t("marketplace.toast.updated"), { description: name })
        await refetch()
        await utils.marketplace.listAvailablePlugins.invalidate()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("marketplace.toast.updateFailed")
        )
      } finally {
        setUpdatingMarketplace(null)
      }
    },
    [updateMutation, refetch, utils, t]
  )

  const handleRemove = useCallback(
    async (name: string) => {
      try {
        await removeMutation.mutateAsync({ name })
        toast.success(t("marketplace.toast.removed"), { description: name })
        await refetch()
        await utils.marketplace.listAvailablePlugins.invalidate()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("marketplace.toast.removeFailed")
        )
      }
    },
    [removeMutation, refetch, utils, t]
  )

  const handleInitOfficial = useCallback(async () => {
    setIsAdding(true)
    try {
      await initOfficialMutation.mutateAsync()
      toast.success(t("marketplace.toast.officialAdded"))
      await refetch()
      await utils.marketplace.listAvailablePlugins.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("marketplace.toast.officialFailed")
      )
    } finally {
      setIsAdding(false)
    }
  }, [initOfficialMutation, refetch, utils, t])

  const hasOfficial = marketplaces.some((m) => m.isOfficial)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("marketplace.manage.title")}</DialogTitle>
          <DialogDescription>
            {t("marketplace.manage.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Add new marketplace */}
          <div className="flex flex-col gap-2">
            <Label>{t("marketplace.manage.addNew")}</Label>
            <div className="flex gap-2">
              <Input
                placeholder="https://github.com/org/marketplace.git"
                value={newGitUrl}
                onChange={(e) => setNewGitUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd()
                }}
                className="flex-1"
                disabled={isAdding}
              />
              <Button
                onClick={handleAdd}
                disabled={isAdding || !newGitUrl.trim()}
                size="icon"
              >
                {isAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Add official marketplace button if not present */}
          {!hasOfficial && !isLoading && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-dashed border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                <div>
                  <p className="text-sm font-medium">
                    {t("marketplace.manage.officialTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("marketplace.manage.officialDescription")}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleInitOfficial}
                disabled={isAdding}
              >
                {isAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Plus className="h-4 w-4 mr-1.5" />
                )}
                {t("marketplace.manage.addOfficial")}
              </Button>
            </div>
          )}

          {/* Marketplace list */}
          <div className="flex flex-col gap-1">
            <Label>{t("marketplace.manage.configured")}</Label>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : marketplaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t("marketplace.manage.noMarketplaces")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-64 overflow-y-auto">
                {marketplaces.map((m) => (
                  <div
                    key={m.name}
                    className={cn(
                      "flex items-start justify-between gap-3 p-3.5 rounded-lg border border-border bg-background",
                      m.isOfficial && "border-orange-500/40 bg-orange-500/5"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{m.name}</p>
                        {m.isOfficial && (
                          <Star className="h-3 w-3 text-orange-500 shrink-0" />
                        )}
                      </div>
                      <a
                        href={m.gitUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-0.5 max-w-full"
                      >
                        <span className="truncate">{m.gitUrl}</span>
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                      {m.lastUpdatedAt && (
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {t("marketplace.manage.lastUpdated")}:{" "}
                          {new Date(m.lastUpdatedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleUpdate(m.name)}
                        disabled={updatingMarketplace === m.name}
                        title={t("marketplace.manage.update")}
                      >
                        {updatingMarketplace === m.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleRemove(m.name)}
                        disabled={removeMutation.isPending}
                        title={t("marketplace.manage.remove")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
