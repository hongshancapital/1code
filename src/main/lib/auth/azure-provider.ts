/**
 * Azure AD OAuth Provider
 *
 * OAuth 2.0 + PKCE implementation for Azure AD (Microsoft Entra ID) authentication.
 */

import { shell } from "electron"
import { AuthProvider, AuthUser, TokenResponse, PkceState } from "./types"
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../okta/pkce"
import { getEnv } from "../env"
import { OKTA_CALLBACK_PORT } from "../../constants"

/**
 * Get Azure AD configuration from environment
 */
function getAzureConfig() {
  const env = getEnv()
  const tenantId = env.MAIN_VITE_AZURE_TENANT_ID
  const clientId = env.MAIN_VITE_AZURE_CLIENT_ID
  const loginUrl = env.MAIN_VITE_AZURE_LOGIN_URL?.replace(/\/$/, "")

  if (!tenantId || !clientId || !loginUrl) {
    throw new Error("Azure AD configuration missing. Set MAIN_VITE_AZURE_TENANT_ID, MAIN_VITE_AZURE_CLIENT_ID, and MAIN_VITE_AZURE_LOGIN_URL.")
  }

  return {
    tenantId,
    clientId,
    // Microsoft identity platform v2.0 endpoints
    authorizeEndpoint: `${loginUrl}/${tenantId}/oauth2/v2.0/authorize`,
    tokenEndpoint: `${loginUrl}/${tenantId}/oauth2/v2.0/token`,
  }
}

/**
 * Parse JWT id_token from Azure AD to extract user information
 * Azure AD id_token contains claims like: oid, email, name, preferred_username
 */
function parseIdToken(idToken: string): AuthUser {
  try {
    const parts = idToken.split(".")
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format")
    }

    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8"))

    // Azure AD uses different claim names
    // oid = Object ID (unique user identifier)
    // preferred_username = email address or UPN
    // name = display name
    return {
      id: payload.oid || payload.sub || "",
      email: payload.email || payload.preferred_username || "",
      name: payload.name || null,
      imageUrl: null, // Azure AD doesn't include picture in id_token by default
      username: payload.preferred_username?.split("@")[0] || null,
    }
  } catch (error) {
    console.error("[Azure] Failed to parse id_token:", error)
    throw new Error("Failed to parse user information from token")
  }
}

export class AzureProvider implements AuthProvider {
  readonly name = "azure" as const

  getRedirectUri(): string {
    // Share the same callback port as Okta
    return `http://localhost:${OKTA_CALLBACK_PORT}/implicit/callback`
  }

  startAuthFlow(): PkceState {
    const { clientId, authorizeEndpoint } = getAzureConfig()

    // Generate PKCE parameters (same as Okta)
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const state = generateState()

    // Build Azure AD authorize URL
    const authorizeUrl = new URL(authorizeEndpoint)
    authorizeUrl.searchParams.set("client_id", clientId)
    authorizeUrl.searchParams.set("response_type", "code")
    // Azure AD scopes: openid, profile, email for id_token; offline_access for refresh_token
    authorizeUrl.searchParams.set("scope", "openid profile email offline_access")
    authorizeUrl.searchParams.set("redirect_uri", this.getRedirectUri())
    authorizeUrl.searchParams.set("state", state)
    authorizeUrl.searchParams.set("code_challenge", codeChallenge)
    authorizeUrl.searchParams.set("code_challenge_method", "S256")
    // Response mode: query returns code in URL query params (default for code flow)
    authorizeUrl.searchParams.set("response_mode", "query")

    console.log("[Azure] Starting PKCE flow...")
    console.log("[Azure] Redirect URI:", this.getRedirectUri())

    shell.openExternal(authorizeUrl.toString())

    return {
      codeVerifier,
      state,
      provider: "azure",
    }
  }

  async exchangeCode(code: string, pkceState: PkceState): Promise<{
    tokenData: TokenResponse
    user: AuthUser
  }> {
    const { clientId, tokenEndpoint } = getAzureConfig()
    const { codeVerifier } = pkceState

    console.log("[Azure] Exchanging authorization code for tokens...")

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: this.getRedirectUri(),
      code,
      code_verifier: codeVerifier,
      // scope is required for Azure AD token endpoint
      scope: "openid profile email offline_access",
    })

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }))
      console.error("[Azure] Token exchange failed:", error)
      throw new Error(
        error.error_description ||
        error.error ||
        `Token exchange failed: ${response.status}`
      )
    }

    const tokenData: TokenResponse = await response.json()
    console.log("[Azure] Token exchange successful")

    if (!tokenData.id_token) {
      throw new Error("No id_token in response. Make sure 'openid' scope is requested.")
    }

    const user = parseIdToken(tokenData.id_token)

    return { tokenData, user }
  }

  async refresh(refreshToken: string): Promise<TokenResponse | null> {
    const { clientId, tokenEndpoint } = getAzureConfig()

    console.log("[Azure] Refreshing token...")

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      scope: "openid profile email offline_access",
    })

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }))
      console.error("[Azure] Refresh failed:", response.status, error)
      return null
    }

    const tokenData: TokenResponse = await response.json()
    console.log("[Azure] Token refreshed successfully")

    return tokenData
  }

  parseIdToken(idToken: string): AuthUser {
    return parseIdToken(idToken)
  }
}
