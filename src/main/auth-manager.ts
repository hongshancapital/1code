import { AuthStore, AuthData, AuthUser, AuthProviderType } from "./auth-store"
import { app, BrowserWindow } from "electron"
import { getEnv, getApiOrigin } from "./lib/env"
import { BROWSER_USER_AGENT } from "./lib/constants"
import {
  PkceState,
  getCurrentProvider,
  getProvider,
  getEffectiveAuthProvider,
  isAuthRequired,
} from "./lib/auth"
import { startOktaServer, stopOktaServer, type AuthCallbackHandlers } from "./lib/auth-callback-server"

// API base URL from validated environment (returns undefined in no-auth mode)
function getApiBaseUrl(): string | undefined {
  return getEnv().MAIN_VITE_API_URL
}

/**
 * Get additional headers for Azure AD authentication
 * Returns the New-Authorizer header if current provider is Azure
 */
export function getAzureAuthHeaders(): Record<string, string> {
  if (getEffectiveAuthProvider() === "azure") {
    return { "New-Authorizer": "MSAL-CN" }
  }
  return {}
}

/**
 * API response type
 */
interface ApiResponse<T> {
  ok: boolean
  status: number
  data: T | null
  error?: string
}

/**
 * Generic API fetch with auth token
 * Handles base URL, authorization header, and error handling
 * Returns error if API is not configured (no-auth mode)
 */
async function fetchApi<T = unknown>(
  path: string,
  accessToken: string,
  options?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  }
): Promise<ApiResponse<T>> {
  const apiBaseUrl = getApiBaseUrl()
  if (!apiBaseUrl) {
    console.warn("[API] API URL not configured - running in no-auth mode")
    return { ok: false, status: 0, data: null, error: "API not configured" }
  }
  const url = `${apiBaseUrl}${path}`
  const method = options?.method || "GET"

  // Build headers - include browser-like headers to pass CloudFront WAF
  const origin = getApiOrigin() || apiBaseUrl
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json, text/plain, */*",
    Origin: origin,
    Referer: `${origin}/`,
    "User-Agent": BROWSER_USER_AGENT,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    ...(options?.body ? { "Content-Type": "application/json" } : {}),
    ...getAzureAuthHeaders(),
    ...options?.headers,
  }

  // Debug logging in dev mode
  console.log("[API] ========== Request Debug ==========")
  console.log("[API] URL:", url)
  console.log("[API] Method:", method)
  console.log("[API] Headers:", JSON.stringify({
    ...headers,
    Authorization: `Bearer ${accessToken.substring(0, 20)}...${accessToken.substring(accessToken.length - 10)}` // Mask token
  }, null, 2))
  if (options?.body) {
    console.log("[API] Body:", JSON.stringify(options.body, null, 2))
  }
  console.log("[API] Token length:", accessToken.length)
  console.log("[API] =====================================")

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    })

    console.log("[API] ========== Response Debug ==========")
    console.log("[API] Status:", response.status, response.statusText)
    console.log("[API] Response Headers:", JSON.stringify(Object.fromEntries((response.headers as any).entries()), null, 2))

    if (response.status === 401) {
      const errorText = await response.text()
      console.log("[API] 401 Response Body:", errorText)
      console.log("[API] =====================================")
      return { ok: false, status: 401, data: null, error: "Token expired" }
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.log("[API] Error Response Body:", errorText)
      console.log("[API] =====================================")
      return { ok: false, status: response.status, data: null, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = await response.json()
    console.log("[API] Success Response Data:", JSON.stringify(data, null, 2))
    console.log("[API] =====================================")
    return { ok: true, status: response.status, data }
  } catch (error) {
    console.error("[API] ========== Fetch Error ==========")
    console.error("[API] Error:", error)
    console.error("[API] =====================================")
    return { ok: false, status: 0, data: null, error: String(error) }
  }
}

/**
 * Build user avatar URL
 */
function buildAvatarUrl(userId: string | number, avatarUpdatedAt?: string | number | null): string | null {
  if (!avatarUpdatedAt) return null
  return `${getApiBaseUrl()}/v1/api/user/avatar/${userId}?avatarUpdatedAt=${avatarUpdatedAt}`
}

// Re-export PkceState for backwards compatibility
export type { PkceState }

/**
 * Fetch user info from backend API
 */
async function fetchUserFromApi(accessToken: string): Promise<AuthUser | null> {
  console.log("[Auth] Fetching user info from API...")

  const response = await fetchApi<{
    id: number | string
    email?: string
    name?: string
    chineseName?: string
    accountName?: string
    avatarUpdatedAt?: string | number
  }>("/v1/api/user", accessToken)

  if (!response.ok || !response.data) {
    return null
  }

  const userInfo = response.data
  console.log("[Auth] Got user info:", userInfo.id, userInfo.name, "avatarUpdatedAt:", userInfo.avatarUpdatedAt)

  const user: AuthUser = {
    id: String(userInfo.id),
    email: userInfo.email || "",
    name: userInfo.name || userInfo.chineseName || null,
    imageUrl: buildAvatarUrl(userInfo.id, userInfo.avatarUpdatedAt),
    username: userInfo.accountName || null,
  }

  console.log("[Auth] User built:", user.email, "avatar:", user.imageUrl ? "yes" : "no")
  return user
}

export class AuthManager {
  private store: AuthStore
  private refreshTimer?: NodeJS.Timeout
  private onTokenRefresh?: (authData: AuthData) => void

  // PKCE state for ongoing auth flow
  private get pkceState(): PkceState | null {
    return this.store.loadPkceState()
  }

  private set pkceState(state: PkceState | null) {
    if (state) {
      this.store.savePkceState(state)
    } else {
      this.store.clearPkceState()
    }
  }

  // Auth callback handlers (set from main process)
  private authCallbackHandlers?: AuthCallbackHandlers

  constructor(_isDev: boolean = false) {
    this.store = new AuthStore(app.getPath("userData"))

    // Log detected auth provider on startup
    const detectedProvider = getEffectiveAuthProvider()
    console.log(`[Auth] Detected auth provider: ${detectedProvider}`)

    // Schedule refresh if already authenticated
    if (this.store.isAuthenticated()) {
      this.scheduleRefresh()
    }
  }

  /**
   * Set auth callback handlers (from main process)
   */
  setAuthCallbackHandlers(handlers: AuthCallbackHandlers): void {
    this.authCallbackHandlers = handlers
  }

  /**
   * Set callback to be called when token is refreshed
   * This allows the main process to update cookies when tokens change
   */
  setOnTokenRefresh(callback: (authData: AuthData) => void): void {
    this.onTokenRefresh = callback
  }

  /**
   * Start OAuth PKCE flow by opening browser
   * Automatically selects Okta or Azure AD based on Windows domain
   * Throws error if running in no-auth mode
   */
  startAuthFlow(_mainWindow: BrowserWindow | null): void {
    try {
      // Get the appropriate auth provider
      const provider = getCurrentProvider()

      if (!provider) {
        console.warn("[Auth] No auth provider configured - running in no-auth mode")
        throw new Error("Authentication is not configured. Running in no-auth mode.")
      }

      console.log(`[Auth] Starting ${provider.name} PKCE flow...`)

      // Start Okta callback server before auth flow (for Okta/Azure providers)
      if ((provider.name === "okta" || provider.name === "azure") && this.authCallbackHandlers) {
        startOktaServer(this.authCallbackHandlers)
      }

      // Start auth flow and store PKCE state
      this.pkceState = provider.startAuthFlow(_mainWindow)

      console.log(`[Auth] Auth flow started with provider: ${provider.name}`)
    } catch (error) {
      console.error("[Auth] Failed to start auth flow:", error)
      // Stop Okta server on error
      stopOktaServer()
      throw error
    }
  }

  /**
   * Get the current PKCE state (for callback verification)
   */
  getPkceState(): PkceState | null {
    return this.pkceState
  }

  /**
   * Clear PKCE state after auth flow completes
   */
  clearPkceState(): void {
    this.pkceState = null
  }

  /**
   * Exchange authorization code for tokens using PKCE
   */
  async exchangeCode(code: string): Promise<AuthData> {
    if (!this.pkceState) {
      throw new Error("No PKCE state found. Start auth flow first.")
    }

    // Get the provider that was used to start this auth flow
    const provider = getProvider(this.pkceState.provider)

    if (!provider) {
      throw new Error("Auth provider not available for token exchange.")
    }

    console.log(`[Auth] Exchanging authorization code using ${provider.name}...`)

    // Exchange code for tokens
    const { tokenData, user: tokenUser } = await provider.exchangeCode(code, this.pkceState)

    // Fetch full user info from backend API (includes avatar)
    let user = tokenUser
    const apiUser = await fetchUserFromApi(tokenData.access_token)
    if (apiUser) {
      // Merge API user info with id_token fallbacks
      user = {
        id: apiUser.id,
        email: apiUser.email || user.email,
        name: apiUser.name || user.name,
        imageUrl: apiUser.imageUrl,
        username: apiUser.username || user.username,
      }
    }

    // Calculate expiration time
    const expiresIn = tokenData.expires_in || 3600 // Default 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    const authData: AuthData = {
      token: tokenData.access_token,
      refreshToken: tokenData.refresh_token || "",
      idToken: tokenData.id_token,
      expiresAt,
      user,
      provider: provider.name, // Store which provider was used
    }

    // Clear PKCE state after successful exchange
    this.clearPkceState()

    // Clear skipped state since user is now authenticated
    this.clearSkipped()

    // Save auth data
    this.store.save(authData)
    this.scheduleRefresh()

    console.log(`[Auth] User authenticated via ${provider.name}:`, user.email, "avatar:", user.imageUrl ? "yes" : "no")

    return authData
  }

  /**
   * Get a valid token, refreshing if necessary
   */
  async getValidToken(): Promise<string | null> {
    if (!this.store.isAuthenticated()) {
      return null
    }

    if (this.store.needsRefresh()) {
      await this.refresh()
    }

    return this.store.getToken()
  }

  /**
   * Refresh the current session using refresh_token
   * Uses the provider that was stored during login
   */
  async refresh(): Promise<boolean> {
    const refreshToken = this.store.getRefreshToken()
    if (!refreshToken) {
      console.warn("[Auth] No refresh token available")
      return false
    }

    // Get the provider that was used for this session
    const providerType = this.store.getProvider()
    const provider = getProvider(providerType)

    if (!provider) {
      console.warn("[Auth] No auth provider available for refresh")
      return false
    }

    console.log(`[Auth] Refreshing token using ${provider.name}...`)

    try {
      const tokenData = await provider.refresh(refreshToken)

      if (!tokenData) {
        console.error("[Auth] Refresh failed - no token data returned")
        // Provider refresh returns null on error, which means refresh token likely expired
        console.log("[Auth] Refresh token expired, logging out...")
        this.logout("session_expired")
        return false
      }

      // Get current user data (may be updated in new id_token)
      let user = this.store.getUser()
      if (tokenData.id_token) {
        user = provider.parseIdToken(tokenData.id_token)
      }

      if (!user) {
        console.error("[Auth] No user data available after refresh")
        return false
      }

      // Calculate expiration time
      const expiresIn = tokenData.expires_in || 3600
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

      const authData: AuthData = {
        token: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken, // Use new refresh token if provided
        idToken: tokenData.id_token,
        expiresAt,
        user,
        provider: providerType, // Preserve the provider type
      }

      this.store.save(authData)
      this.scheduleRefresh()

      console.log(`[Auth] Token refreshed successfully via ${provider.name}`)

      // Notify callback about token refresh (so cookie can be updated)
      if (this.onTokenRefresh) {
        this.onTokenRefresh(authData)
      }

      return true
    } catch (error) {
      console.error("[Auth] Refresh error:", error)
      return false
    }
  }

  /**
   * Schedule token refresh before expiration
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
    }

    const authData = this.store.load()
    if (!authData) return

    const expiresAt = new Date(authData.expiresAt).getTime()
    const now = Date.now()

    // Refresh 5 minutes before expiration
    const refreshIn = Math.max(0, expiresAt - now - 5 * 60 * 1000)

    this.refreshTimer = setTimeout(() => {
      this.refresh()
    }, refreshIn)

    console.log(`[Auth] Scheduled token refresh in ${Math.round(refreshIn / 1000 / 60)} minutes`)
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.store.isAuthenticated()
  }

  /**
   * Skip authentication (user chose to skip login)
   */
  skipAuth(): void {
    this.store.saveSkipped(true)
    console.log("[Auth] Authentication skipped by user")
  }

  /**
   * Check if authentication was skipped
   */
  isSkipped(): boolean {
    return this.store.isSkipped()
  }

  /**
   * Clear skipped state (when user logs in)
   */
  clearSkipped(): void {
    this.store.clearSkipped()
  }

  /**
   * Check if there's saved auth that might be refreshable
   * Used to distinguish returning users (token expired) from first-time users
   */
  hasSavedAuth(): boolean {
    return this.store.hasSavedAuth()
  }

  /**
   * Get saved provider type (for auto-login with same provider)
   */
  getSavedProvider(): AuthProviderType | null {
    const data = this.store.load()
    return data?.provider ?? null
  }

  /**
   * Get current user
   */
  getUser(): AuthUser | null {
    return this.store.getUser()
  }

  /**
   * Get current auth data
   */
  getAuth(): AuthData | null {
    return this.store.load()
  }

  /**
   * Logout and clear stored credentials.
   * Optionally triggered by session expiration (when refresh token fails).
   *
   * @param reason - Optional reason for logout ("manual" | "session_expired")
   */
  logout(reason: "manual" | "session_expired" = "manual"): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
    this.clearPkceState()
    this.store.clear()

    // Notify all renderer windows about logout
    // Use different events for manual logout vs session expiration
    const eventName = reason === "session_expired" ? "auth:session-expired" : "auth:logout"
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(eventName, { reason })
    })

    console.log(`[Auth] User logged out (reason: ${reason})`)
  }

  /**
   * Update user profile locally
   * Note: For Okta, profile updates should be done through Okta admin
   */
  async updateUser(updates: { name?: string }): Promise<AuthUser | null> {
    // For Okta, we just update local storage
    // The user's profile in Okta itself should be managed through Okta admin console
    return this.store.updateUser({ name: updates.name ?? null })
  }

  /**
   * Validate saved token and refresh user info from API
   * Returns user data if valid, null if token invalid/expired
   * Call this on app startup to ensure token is valid and get latest user info
   */
  async validateAndRefreshUser(): Promise<AuthUser | null> {
    const token = this.store.getToken()
    if (!token) {
      console.log("[Auth] No saved token found")
      return null
    }

    console.log("[Auth] Validating token with API...")
    const user = await fetchUserFromApi(token)

    if (!user) {
      // Token expired or API failed
      return null
    }

    // Update stored user info
    this.store.updateUser({
      id: user.id,
      email: user.email,
      name: user.name,
      imageUrl: user.imageUrl,
      username: user.username,
    })

    return user
  }

  /**
   * Fetch user's subscription plan from web backend
   */
  async fetchUserPlan(): Promise<{ email: string; plan: string; status: string | null } | null> {
    const token = await this.getValidToken()
    if (!token) return null

    try {
      const apiUrl = getEnv().MAIN_VITE_API_URL

      const response = await fetch(`${apiUrl}/api/desktop/user/plan`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Desktop-Token": token, // Keep for backwards compatibility
          ...getAzureAuthHeaders(),
        },
      })

      if (!response.ok) {
        console.error("[Auth] Failed to fetch user plan:", response.status)
        return null
      }

      return response.json()
    } catch (error) {
      console.error("[Auth] Failed to fetch user plan:", error)
      return null
    }
  }
}

// Global singleton instance
let authManagerInstance: AuthManager | null = null

/**
 * Initialize the global auth manager instance
 * Must be called once from main process initialization
 */
export function initAuthManager(isDev: boolean = false): AuthManager {
  if (!authManagerInstance) {
    authManagerInstance = new AuthManager(isDev)
  }
  return authManagerInstance
}

/**
 * Get the global auth manager instance
 * Returns null if not initialized
 */
export function getAuthManager(): AuthManager | null {
  return authManagerInstance
}
