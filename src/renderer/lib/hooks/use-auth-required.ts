import { useAtomValue, useSetAtom } from "jotai"
import { authSkippedAtom, agentsSettingsDialogActiveTabAtom, agentsSettingsDialogOpenAtom } from "../atoms"

/**
 * Hook to check if authentication is required for a feature
 * Returns helper function to navigate to Account settings if auth was skipped
 */
export function useAuthRequired() {
  const isSkipped = useAtomValue(authSkippedAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)

  /**
   * Check if user is authenticated (not skipped)
   * Navigates to Account settings if auth was skipped
   * @param _message Unused, kept for backwards compatibility
   * @returns true if authenticated, false if skipped
   */
  const requireAuth = (_message?: string): boolean => {
    if (isSkipped) {
      // Navigate to Account settings page for login
      setSettingsActiveTab("profile")
      setSettingsOpen(true)
      return false
    }
    return true
  }

  /**
   * Navigate to Account settings page (for login)
   */
  const navigateToLogin = () => {
    setSettingsActiveTab("profile")
    setSettingsOpen(true)
  }

  return { requireAuth, isSkipped, navigateToLogin }
}
