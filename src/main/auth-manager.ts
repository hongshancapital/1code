import { AuthStore, AuthData, AuthUser } from "./auth-store"
import { app, BrowserWindow } from "electron"
import { AUTH_SERVER_PORT, OKTA_CALLBACK_PORT } from "./constants"
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./lib/okta/pkce"
import { getEnv, getApiOrigin } from "./lib/env"

// Okta configuration from validated environment
function getOktaConfig() {
  const env = getEnv()
  return {
    issuer: env.MAIN_VITE_OKTA_ISSUER,
    clientId: env.MAIN_VITE_OKTA_CLIENT_ID,
  }
}

// API base URL from validated environment
function getApiBaseUrl(): string {
  return getEnv().MAIN_VITE_API_URL
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
  const url = `${apiBaseUrl}${path}`
  const method = options?.method || "GET"

  // Build headers - include browser-like headers to pass CloudFront WAF
  const origin = getApiOrigin()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json, text/plain, */*",
    Origin: origin,
    Referer: `${origin}/`,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    ...(options?.body ? { "Content-Type": "application/json" } : {}),
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

// PKCE flow state (stored in memory during auth flow)
interface PkceState {
  codeVerifier: string
  state: string
}

/**
 * Parse JWT id_token to extract user information
 * Note: This is a simple decode, not a full verification
 * The token signature should be verified by the backend when making API calls
 */
function parseIdToken(idToken: string): AuthUser {
  try {
    // JWT format: header.payload.signature
    const parts = idToken.split(".")
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format")
    }

    // Decode base64url payload
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8"))

    return {
      id: payload.sub || payload.uid || "",
      email: payload.email || "",
      name: payload.name || payload.preferred_username || null,
      imageUrl: payload.picture || null,
      username: payload.preferred_username || payload.email?.split("@")[0] || null,
    }
  } catch (error) {
    console.error("[Auth] Failed to parse id_token:", error)
    throw new Error("Failed to parse user information from token")
  }
}

export class AuthManager {
  private store: AuthStore
  private refreshTimer?: NodeJS.Timeout
  private isDev: boolean
  private onTokenRefresh?: (authData: AuthData) => void

  // PKCE state for ongoing auth flow
  private pkceState: PkceState | null = null

  constructor(isDev: boolean = false) {
    this.store = new AuthStore(app.getPath("userData"))
    this.isDev = isDev

    // Schedule refresh if already authenticated
    if (this.store.isAuthenticated()) {
      this.scheduleRefresh()
    }
  }

  /**
   * Set callback to be called when token is refreshed
   * This allows the main process to update cookies when tokens change
   */
  setOnTokenRefresh(callback: (authData: AuthData) => void): void {
    this.onTokenRefresh = callback
  }

  /**
   * Get the redirect URI for Okta callback
   * Automatically uses correct port based on dev/production mode
   * Dev: port 3300, Production: port 3000
   */
  private getRedirectUri(): string {
    return `http://localhost:${OKTA_CALLBACK_PORT}/implicit/callback`
  }

  /**
   * Get device info for logging/debugging
   */
  private getDeviceInfo(): string {
    const platform = process.platform
    const arch = process.arch
    const version = app.getVersion()
    return `Hong Desktop ${version} (${platform} ${arch})`
  }

  /**
   * Start Okta OAuth PKCE flow by opening browser
   */
  startAuthFlow(_mainWindow: BrowserWindow | null): void {
    const { shell } = require("electron")

    try {
      const { issuer, clientId } = getOktaConfig()

      // Generate PKCE parameters
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = generateCodeChallenge(codeVerifier)
      const state = generateState()

      // Store PKCE state for later verification
      this.pkceState = { codeVerifier, state }

      // Build Okta authorize URL
      const authorizeUrl = new URL(`${issuer}/v1/authorize`)
      authorizeUrl.searchParams.set("client_id", clientId)
      authorizeUrl.searchParams.set("response_type", "code")
      authorizeUrl.searchParams.set("scope", "openid profile email offline_access")
      authorizeUrl.searchParams.set("redirect_uri", this.getRedirectUri())
      authorizeUrl.searchParams.set("state", state)
      authorizeUrl.searchParams.set("code_challenge", codeChallenge)
      authorizeUrl.searchParams.set("code_challenge_method", "S256")

      console.log("[Auth] Starting Okta PKCE flow...")
      console.log("[Auth] Redirect URI:", this.getRedirectUri())

      shell.openExternal(authorizeUrl.toString())
    } catch (error) {
      console.error("[Auth] Failed to start auth flow:", error)
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

    const { issuer, clientId } = getOktaConfig()
    const { codeVerifier } = this.pkceState

    console.log("[Auth] Exchanging authorization code for tokens...")

    // Exchange code for tokens
    const tokenUrl = `${issuer}/v1/token`
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: this.getRedirectUri(),
      code,
      code_verifier: codeVerifier,
    })

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }))
      console.error("[Auth] Token exchange failed:", error)
      throw new Error(error.error_description || error.error || `Token exchange failed: ${response.status}`)
    }

    const tokenData = await response.json()
    console.log("[Auth] Token exchange successful")

    // Parse basic user info from id_token first
    if (!tokenData.id_token) {
      throw new Error("No id_token in response. Make sure 'openid' scope is requested.")
    }

    let user = parseIdToken(tokenData.id_token)

    // Fetch full user info from backend API (includes avatar)
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
      refreshToken: tokenData.refresh_token,
      idToken: tokenData.id_token,
      expiresAt,
      user,
    }

    // Clear PKCE state after successful exchange
    this.clearPkceState()

    // Save auth data
    this.store.save(authData)
    this.scheduleRefresh()

    console.log("[Auth] User authenticated:", user.email, "avatar:", user.imageUrl ? "yes" : "no")

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
   */
  async refresh(): Promise<boolean> {
    const refreshToken = this.store.getRefreshToken()
    if (!refreshToken) {
      console.warn("[Auth] No refresh token available")
      return false
    }

    try {
      const { issuer, clientId } = getOktaConfig()

      console.log("[Auth] Refreshing token...")

      const tokenUrl = `${issuer}/v1/token`
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
        scope: "openid profile email offline_access",
      })

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Unknown error" }))
        console.error("[Auth] Refresh failed:", response.status, error)

        // If refresh fails with 401/400, the refresh token is likely expired
        if (response.status === 401 || response.status === 400) {
          console.log("[Auth] Refresh token expired, logging out...")
          this.logout("session_expired")
        }
        return false
      }

      const tokenData = await response.json()

      // Get current user data (may be updated in new id_token)
      let user = this.store.getUser()
      if (tokenData.id_token) {
        user = parseIdToken(tokenData.id_token)
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
      }

      this.store.save(authData)
      this.scheduleRefresh()

      console.log("[Auth] Token refreshed successfully")

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
   * Used for PostHog analytics enrichment
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
