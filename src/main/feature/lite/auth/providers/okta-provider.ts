/**
 * Okta OAuth Provider
 *
 * OAuth 2.0 + PKCE implementation for Okta authentication.
 */

import { shell } from "electron"
import { AuthProvider, AuthUser, TokenResponse, PkceState } from "./types"
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../../../../lib/okta/pkce"
import { getEnv } from "../../../../lib/env"
import { OKTA_CALLBACK_PORT } from "../../../../constants"

/**
 * Get Okta configuration from environment.
 * Throws error if Okta is not configured (caller should check isOktaConfigured() first).
 */
function getOktaConfig(): { issuer: string; clientId: string } {
  const env = getEnv()
  const issuer = env.MAIN_VITE_OKTA_ISSUER
  const clientId = env.MAIN_VITE_OKTA_CLIENT_ID

  if (!issuer || !clientId) {
    throw new Error("Okta configuration missing. Ensure MAIN_VITE_OKTA_ISSUER and MAIN_VITE_OKTA_CLIENT_ID are set.")
  }

  return { issuer, clientId }
}

/**
 * Parse JWT id_token to extract user information
 */
function parseIdToken(idToken: string): AuthUser {
  try {
    const parts = idToken.split(".")
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format")
    }

    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8"))

    return {
      id: payload.sub || payload.uid || "",
      email: payload.email || "",
      name: payload.name || payload.preferred_username || null,
      imageUrl: payload.picture || null,
      username: payload.preferred_username || payload.email?.split("@")[0] || null,
    }
  } catch (error) {
    console.error("[Okta] Failed to parse id_token:", error)
    throw new Error("Failed to parse user information from token")
  }
}

export class OktaProvider implements AuthProvider {
  readonly name = "okta" as const

  getRedirectUri(): string {
    return `http://localhost:${OKTA_CALLBACK_PORT}/implicit/callback`
  }

  startAuthFlow(): PkceState {
    const { issuer, clientId } = getOktaConfig()

    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const state = generateState()

    // Build Okta authorize URL
    const authorizeUrl = new URL(`${issuer}/v1/authorize`)
    authorizeUrl.searchParams.set("client_id", clientId)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("scope", "openid profile email offline_access")
    authorizeUrl.searchParams.set("redirect_uri", this.getRedirectUri())
    authorizeUrl.searchParams.set("state", state)
    authorizeUrl.searchParams.set("code_challenge", codeChallenge)
    authorizeUrl.searchParams.set("code_challenge_method", "S256")

    console.log("[Okta] Starting PKCE flow...")
    console.log("[Okta] Redirect URI:", this.getRedirectUri())

    shell.openExternal(authorizeUrl.toString())

    return {
      codeVerifier,
      state,
      provider: "okta",
    }
  }

  async exchangeCode(code: string, pkceState: PkceState): Promise<{
    tokenData: TokenResponse
    user: AuthUser
  }> {
    const { issuer, clientId } = getOktaConfig()
    const { codeVerifier } = pkceState

    console.log("[Okta] Exchanging authorization code for tokens...")

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
      console.error("[Okta] Token exchange failed:", error)
      throw new Error(error.error_description || error.error || `Token exchange failed: ${response.status}`)
    }

    const tokenData: TokenResponse = await response.json()
    console.log("[Okta] Token exchange successful")

    if (!tokenData.id_token) {
      throw new Error("No id_token in response. Make sure 'openid' scope is requested.")
    }

    const user = parseIdToken(tokenData.id_token)

    return { tokenData, user }
  }

  async refresh(refreshToken: string): Promise<TokenResponse | null> {
    const { issuer, clientId } = getOktaConfig()

    console.log("[Okta] Refreshing token...")

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
      console.error("[Okta] Refresh failed:", response.status, error)
      return null
    }

    const tokenData: TokenResponse = await response.json()
    console.log("[Okta] Token refreshed successfully")

    return tokenData
  }

  parseIdToken(idToken: string): AuthUser {
    return parseIdToken(idToken)
  }
}
