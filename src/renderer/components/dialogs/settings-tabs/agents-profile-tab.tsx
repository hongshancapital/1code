import { useState, useEffect, useCallback, useRef } from "react"
import { LogOut, User } from "lucide-react"
import { useAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Textarea } from "../../ui/textarea"
import { IconSpinner } from "../../../icons"
import { toast } from "sonner"
import { userPersonalizationAtom } from "../../../lib/atoms"
import { createLogger } from "../../../lib/logger"

const profileLog = createLogger("Profile")


// Hook to detect narrow screen
function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrow(window.innerWidth <= 768)
    }

    checkWidth()
    window.addEventListener("resize", checkWidth)
    return () => window.removeEventListener("resize", checkWidth)
  }, [])

  return isNarrow
}

interface DesktopUser {
  id: string
  email: string
  name: string | null
  imageUrl: string | null
  username: string | null
}

// Cache for last refresh time (5 minutes)
const REFRESH_CACHE_MS = 5 * 60 * 1000
let lastRefreshTime = 0

export function AgentsProfileTab() {
  const { t } = useTranslation("settings")
  const [user, setUser] = useState<DesktopUser | null>(null)
  const [fullName, setFullName] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const isNarrowScreen = useIsNarrowScreen()
  const savedNameRef = useRef("")

  // Refresh user info from API (with cache check)
  const refreshUserFromApi = async (force = false) => {
    const now = Date.now()

    // Skip if recently refreshed (unless forced)
    if (!force && lastRefreshTime && now - lastRefreshTime < REFRESH_CACHE_MS) {
      profileLog.info("Skipping refresh, cache still valid")
      return false
    }

    if (window.desktopApi?.refreshUser) {
      const userData = await window.desktopApi.refreshUser()
      if (userData) {
        setUser(userData)
        setFullName(userData.name || "")
        lastRefreshTime = now
        return true
      }
    }
    return false
  }

  // On mount: first get cached user, then refresh from API
  useEffect(() => {
    async function init() {
      // First load cached user data for immediate display
      if (window.desktopApi?.getUser) {
        const userData = await window.desktopApi.getUser()
        setUser(userData)
        setFullName(userData?.name || "")
        savedNameRef.current = userData?.name || ""
      }
      setIsLoading(false)

      // Then refresh from API in background (respects cache)
      await refreshUserFromApi()
    }
    init()
  }, [])

  // Manual refresh (force bypass cache)
  const handleRefreshAvatar = async () => {
    setIsRefreshing(true)
    try {
      const refreshed = await refreshUserFromApi(true)
      if (refreshed) {
        toast.success("Profile refreshed")
      }
    } catch (error) {
      profileLog.error("Failed to refresh profile:", error)
      toast.error("Failed to refresh profile")
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleBlurSave = useCallback(async () => {
    const trimmed = fullName.trim()
    if (trimmed === savedNameRef.current) return
    try {
      if (window.desktopApi?.updateUser) {
        const updatedUser = await window.desktopApi.updateUser({ name: trimmed })
        if (updatedUser) {
          setUser(updatedUser)
          savedNameRef.current = updatedUser.name || ""
          setFullName(updatedUser.name || "")
        }
      }
    } catch (error) {
      profileLog.error("Error updating profile:", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to update profile"
      )
    }
  }, [fullName])

  const handleLogout = async () => {
    if (window.desktopApi?.logout) {
      await window.desktopApi.logout()
    }
  }

  const handleLogin = () => {
    window.desktopApi?.startAuthFlow?.()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <IconSpinner className="h-6 w-6" />
      </div>
    )
  }

  // Not logged in state - show sign in prompt + personalization
  if (!user) {
    return (
      <div className="p-6 flex flex-col gap-6">
        {!isNarrowScreen && (
          <div className="flex items-center justify-between pb-3 mb-4">
            <h3 className="text-sm font-medium text-foreground">
              {t("profile.title")}
            </h3>
          </div>
        )}

        {/* Sign in card */}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-muted-foreground px-1">
            {t("profile.account.title")}
          </h4>
          <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30 border border-border/50">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center border border-border">
              <User className="w-6 h-6 text-muted-foreground/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground">
                {t("profile.account.signInPrompt")}
              </p>
            </div>
            <Button
              onClick={handleLogin}
              size="sm"
              className="shrink-0"
            >
              {t("profile.account.signIn")}
            </Button>
          </div>
        </div>

        {/* Personalization Section - always visible */}
        <PersonalizationSection />
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      {!isNarrowScreen && (
        <div className="flex items-center justify-between pb-3 mb-4">
          <h3 className="text-sm font-medium text-foreground">
            {t("profile.title")}
          </h3>
        </div>
      )}

      {/* Account Section */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium text-muted-foreground px-1">
          {t("profile.account.title")}
        </h4>
        {/* User Avatar Card */}
        <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30 border border-border/50">
          {/* Avatar - clickable to refresh */}
          <button
            type="button"
            onClick={handleRefreshAvatar}
            disabled={isRefreshing}
            className="shrink-0 rounded-full overflow-hidden transition-all hover:ring-2 hover:ring-primary/50 active:scale-95 disabled:opacity-50"
            title="Click to refresh"
          >
            {isRefreshing ? (
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <IconSpinner className="w-6 h-6" />
              </div>
            ) : user.imageUrl ? (
              <img
                src={user.imageUrl}
                alt={user.name || user.email}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <span className="text-2xl font-medium text-muted-foreground">
                  {(user.name || user.email || "U").charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </button>

          {/* User Details */}
          <div className="flex-1 min-w-0">
            <h4 className="text-base font-medium truncate">
              {user.name || "User"}
            </h4>
            <p className="text-sm text-muted-foreground truncate">
              {user.email}
            </p>
          </div>
        </div>

        {/* Profile Settings Card */}
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {/* Full Name Field */}
          <div className="flex items-center justify-between p-4">
            <div className="flex-1">
              <Label className="text-sm font-medium">
                {t("profile.account.fullName")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("profile.account.fullNameDescription")}
              </p>
            </div>
            <div className="shrink-0 w-80">
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onBlur={handleBlurSave}
                className="w-full"
                placeholder={t("profile.account.fullNamePlaceholder")}
              />
            </div>
          </div>

          {/* Email Field (read-only) */}
          <div className="flex items-center justify-between p-4 border-t border-border">
            <div className="flex-1">
              <Label className="text-sm font-medium">
                {t("profile.account.email")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("profile.account.emailDescription")}
              </p>
            </div>
            <div className="shrink-0 w-80">
              <Input
                value={user?.email || ""}
                disabled
                className="w-full opacity-60"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Personalization Section */}
      <PersonalizationSection />

      {/* Sign Out */}
      <div className="pt-4">
        <Button
          variant="outline"
          onClick={handleLogout}
          className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="w-4 h-4" />
          {t("profile.account.signOut")}
        </Button>
      </div>
    </div>
  )
}

// Personalization settings section
function PersonalizationSection() {
  const { t } = useTranslation("settings")
  const [personalization, setPersonalization] = useAtom(userPersonalizationAtom)

  const updateField = useCallback(
    (field: keyof typeof personalization, value: string) => {
      setPersonalization((prev) => ({ ...prev, [field]: value }))
    },
    [setPersonalization],
  )

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-muted-foreground px-1">
        {t("profile.personalization.title")}
      </h4>
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        {/* Preferred Name */}
        <div className="flex items-center justify-between p-4">
          <div className="flex-1 min-w-0 pr-4">
            <Label className="text-sm font-medium">
              {t("profile.personalization.preferredName.label")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("profile.personalization.preferredName.description")}
            </p>
          </div>
          <div className="shrink-0 w-60">
            <Input
              value={personalization.preferredName}
              onChange={(e) => updateField("preferredName", e.target.value)}
              maxLength={50}
              placeholder={t("profile.personalization.preferredName.placeholder")}
              className="w-full"
            />
          </div>
        </div>

        {/* Personal Preferences */}
        <div className="flex flex-col gap-2 p-4 border-t border-border">
          <div>
            <Label className="text-sm font-medium">
              {t("profile.personalization.preferences.label")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("profile.personalization.preferences.description")}
            </p>
          </div>
          <Textarea
            value={personalization.personalPreferences}
            onChange={(e) =>
              updateField("personalPreferences", e.target.value)
            }
            maxLength={1000}
            placeholder={t("profile.personalization.preferences.placeholder")}
            rows={4}
            className="resize-none"
          />
          <span className="text-xs text-muted-foreground text-right">
            {personalization.personalPreferences.length} / 1000
          </span>
        </div>
      </div>
    </div>
  )
}
