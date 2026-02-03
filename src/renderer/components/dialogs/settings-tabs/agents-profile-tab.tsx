import { useState, useEffect, useCallback, useRef } from "react"
import { LogOut, User } from "lucide-react"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { IconSpinner } from "../../../icons"
import { toast } from "sonner"

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
      console.log("[Profile] Skipping refresh, cache still valid")
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
      console.error("Failed to refresh profile:", error)
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
      console.error("Error updating profile:", error)
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

  // Not logged in state
  if (!user) {
    return (
      <div className="p-6 flex flex-col gap-6">
        {!isNarrowScreen && (
          <div className="flex items-center justify-between pb-3 mb-4">
            <h3 className="text-sm font-medium text-foreground">Profile</h3>
          </div>
        )}

        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
            <User className="w-10 h-10 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">Not signed in</p>
          <Button onClick={handleLogin}>
            Sign in
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      {!isNarrowScreen && (
        <div className="flex items-center justify-between pb-3 mb-4">
          <h3 className="text-sm font-medium text-foreground">Profile</h3>
        </div>
      )}

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
      <div className="flex flex-col gap-2">
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {/* Full Name Field */}
          <div className="flex items-center justify-between p-4">
            <div className="flex-1">
              <Label className="text-sm font-medium">Full Name</Label>
              <p className="text-sm text-muted-foreground">
                This is your display name
              </p>
            </div>
            <div className="shrink-0 w-80">
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onBlur={handleBlurSave}
                className="w-full"
                placeholder="Enter your name"
              />
            </div>
          </div>

          {/* Email Field (read-only) */}
          <div className="flex items-center justify-between p-4 border-t border-border">
            <div className="flex-1">
              <Label className="text-sm font-medium">Email</Label>
              <p className="text-sm text-muted-foreground">
                Your account email
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

      {/* Sign Out */}
      <div className="pt-4">
        <Button
          variant="outline"
          onClick={handleLogout}
          className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </Button>
      </div>
    </div>
  )
}
