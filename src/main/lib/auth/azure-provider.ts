/**
 * Azure AD OAuth Provider using MSAL Node
 *
 * Uses @azure/msal-node for desktop application authentication.
 * This approach works with SPA-configured redirect URIs in Azure Portal.
 */

import { PublicClientApplication, LogLevel } from "@azure/msal-node"
import { randomBytes, createHash } from "crypto"
import { shell } from "electron"
import { AuthProvider, AuthUser, TokenResponse, PkceState } from "./types"
import { getEnv } from "../env"
import { OKTA_CALLBACK_PORT } from "../../constants"

// Scopes required for authentication
const SCOPES = ["openid", "profile", "email", "offline_access"]

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
    authority: `${loginUrl}/${tenantId}`,
  }
}

/**
 * Parse JWT id_token from Azure AD to extract user information
 */
function parseIdToken(idToken: string): AuthUser {
  try {
    const parts = idToken.split(".")
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format")
    }

    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8"))

    return {
      id: payload.oid || payload.sub || "",
      email: payload.email || payload.preferred_username || "",
      name: payload.name || null,
      imageUrl: null,
      username: payload.preferred_username?.split("@")[0] || null,
    }
  } catch (error) {
    console.error("[Azure] Failed to parse id_token:", error)
    throw new Error("Failed to parse user information from token")
  }
}

// Singleton MSAL instance
let msalInstance: PublicClientApplication | null = null

// Store PKCE verifier for token exchange
let pendingPkceVerifier: string | null = null

/**
 * Get or create MSAL PublicClientApplication instance
 */
function getMsalInstance(): PublicClientApplication {
  if (!msalInstance) {
    const { clientId, authority } = getAzureConfig()

    msalInstance = new PublicClientApplication({
      auth: {
        clientId,
        authority,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message) => {
            if (level === LogLevel.Error) {
              console.error("[MSAL]", message)
            } else if (level === LogLevel.Warning) {
              console.warn("[MSAL]", message)
            } else {
              console.log("[MSAL]", message)
            }
          },
          piiLoggingEnabled: false,
          logLevel: LogLevel.Warning,
        },
      },
    })
  }
  return msalInstance
}

/**
 * Generate PKCE code verifier (synchronous)
 */
function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Generate PKCE code challenge from verifier (synchronous)
 */
function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

/**
 * Generate random state for CSRF protection
 */
function generateState(): string {
  return randomBytes(16).toString("hex")
}

export class AzureProvider implements AuthProvider {
  readonly name = "azure" as const

  getRedirectUri(): string {
    return `http://localhost:${OKTA_CALLBACK_PORT}/implicit/callback`
  }

  startAuthFlow(): PkceState {
    const { clientId, authority } = getAzureConfig()

    // Generate PKCE codes (synchronous)
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)
    pendingPkceVerifier = verifier

    // Generate state for CSRF protection
    const state = generateState()

    // Build authorization URL manually (MSAL's getAuthCodeUrl is async)
    const authorizeUrl = new URL(`${authority}/oauth2/v2.0/authorize`)
    authorizeUrl.searchParams.set("client_id", clientId)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("redirect_uri", this.getRedirectUri())
    authorizeUrl.searchParams.set("scope", SCOPES.join(" "))
    authorizeUrl.searchParams.set("state", state)
    authorizeUrl.searchParams.set("code_challenge", challenge)
    authorizeUrl.searchParams.set("code_challenge_method", "S256")
    authorizeUrl.searchParams.set("response_mode", "query")

    console.log("[Azure] Starting MSAL PKCE flow...")
    console.log("[Azure] Redirect URI:", this.getRedirectUri())

    shell.openExternal(authorizeUrl.toString())

    return {
      codeVerifier: verifier,
      state,
      provider: "azure",
    }
  }

  async exchangeCode(code: string, pkceState: PkceState): Promise<{
    tokenData: TokenResponse
    user: AuthUser
  }> {
    console.log("[Azure] Exchanging authorization code using MSAL...")

    const msal = getMsalInstance()
    const codeVerifier = pkceState.codeVerifier || pendingPkceVerifier

    if (!codeVerifier) {
      throw new Error("No PKCE verifier found for token exchange")
    }

    try {
      const result = await msal.acquireTokenByCode({
        code,
        scopes: SCOPES,
        redirectUri: this.getRedirectUri(),
        codeVerifier,
      })

      console.log("[Azure] Token exchange successful")

      // Clear pending verifier
      pendingPkceVerifier = null

      // Build token response
      const tokenData: TokenResponse = {
        access_token: result.accessToken,
        id_token: result.idToken,
        expires_in: Math.floor((result.expiresOn!.getTime() - Date.now()) / 1000),
        token_type: "Bearer",
        // MSAL doesn't return refresh_token directly, it's cached internally
        // We'll use the account for silent token renewal
      }

      // Parse user from id_token
      const user = result.idToken ? parseIdToken(result.idToken) : {
        id: result.account?.localAccountId || "",
        email: result.account?.username || "",
        name: result.account?.name || null,
        imageUrl: null,
        username: result.account?.username?.split("@")[0] || null,
      }

      return { tokenData, user }
    } catch (error) {
      console.error("[Azure] MSAL token exchange failed:", error)
      throw error
    }
  }

  async refresh(_refreshToken: string): Promise<TokenResponse | null> {
    console.log("[Azure] Refreshing token using MSAL...")

    const msal = getMsalInstance()

    try {
      // Get the cached account
      const accounts = await msal.getTokenCache().getAllAccounts()
      const account = accounts[0]

      if (!account) {
        console.warn("[Azure] No cached account found for silent refresh")
        return null
      }

      const result = await msal.acquireTokenSilent({
        account,
        scopes: SCOPES,
        forceRefresh: true,
      })

      console.log("[Azure] Token refreshed successfully")

      return {
        access_token: result.accessToken,
        id_token: result.idToken,
        expires_in: Math.floor((result.expiresOn!.getTime() - Date.now()) / 1000),
        token_type: "Bearer",
      }
    } catch (error) {
      console.error("[Azure] MSAL refresh failed:", error)
      return null
    }
  }

  parseIdToken(idToken: string): AuthUser {
    return parseIdToken(idToken)
  }
}
