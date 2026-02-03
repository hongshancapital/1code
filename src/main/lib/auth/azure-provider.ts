/**
 * Azure AD OAuth Provider for SPA-configured redirect URIs
 *
 * Uses a hidden BrowserWindow to perform token exchange via cross-origin request,
 * which is required when Azure Portal is configured with SPA redirect URI type.
 *
 * The SPA configuration requires tokens to be redeemed via browser-based
 * cross-origin requests, not server-side HTTP requests.
 */

import { BrowserWindow } from "electron"
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
    tokenEndpoint: `${loginUrl}/${tenantId}/oauth2/v2.0/token`,
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

/**
 * Exchange authorization code for tokens using a hidden BrowserWindow.
 * This makes the request appear as a cross-origin browser request,
 * which is required for SPA-configured redirect URIs in Azure AD.
 */
async function exchangeCodeViaBrowser(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const { clientId, tokenEndpoint } = getAzureConfig()

  console.log("[Azure] Exchanging code via browser window...")

  return new Promise((resolve, reject) => {
    // Create a hidden browser window for the token exchange
    const tokenWindow = new BrowserWindow({
      width: 400,
      height: 300,
      show: false, // Hidden window
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    // Build the token request body
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
      scope: SCOPES.join(" "),
    }).toString()

    // JavaScript to execute the token exchange via fetch
    const script = `
      (async function() {
        try {
          const response = await fetch("${tokenEndpoint}", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Accept": "application/json",
            },
            body: "${body}",
          });

          const data = await response.json();

          if (!response.ok) {
            return { error: true, data };
          }

          return { error: false, data };
        } catch (err) {
          return { error: true, data: { error: err.message } };
        }
      })();
    `

    // Set timeout for the token exchange
    const timeout = setTimeout(() => {
      tokenWindow.destroy()
      reject(new Error("Token exchange timed out"))
    }, 30000)

    // Load a minimal HTML page and execute the token exchange
    tokenWindow.loadURL("data:text/html,<html><body></body></html>")

    tokenWindow.webContents.on("did-finish-load", async () => {
      try {
        const result = await tokenWindow.webContents.executeJavaScript(script)

        clearTimeout(timeout)
        tokenWindow.destroy()

        if (result.error) {
          const errorData = result.data
          const errorMsg = errorData.error_description || errorData.error || "Token exchange failed"
          reject(new Error(errorMsg))
        } else {
          resolve(result.data as TokenResponse)
        }
      } catch (err) {
        clearTimeout(timeout)
        tokenWindow.destroy()
        reject(err)
      }
    })
  })
}

/**
 * Refresh token using a hidden BrowserWindow
 */
async function refreshTokenViaBrowser(refreshToken: string): Promise<TokenResponse | null> {
  const { clientId, tokenEndpoint } = getAzureConfig()

  console.log("[Azure] Refreshing token via browser window...")

  return new Promise((resolve) => {
    const tokenWindow = new BrowserWindow({
      width: 400,
      height: 300,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      scope: SCOPES.join(" "),
    }).toString()

    const script = `
      (async function() {
        try {
          const response = await fetch("${tokenEndpoint}", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Accept": "application/json",
            },
            body: "${body}",
          });

          const data = await response.json();

          if (!response.ok) {
            return { error: true, data };
          }

          return { error: false, data };
        } catch (err) {
          return { error: true, data: { error: err.message } };
        }
      })();
    `

    const timeout = setTimeout(() => {
      tokenWindow.destroy()
      resolve(null)
    }, 30000)

    tokenWindow.loadURL("data:text/html,<html><body></body></html>")

    tokenWindow.webContents.on("did-finish-load", async () => {
      try {
        const result = await tokenWindow.webContents.executeJavaScript(script)

        clearTimeout(timeout)
        tokenWindow.destroy()

        if (result.error) {
          console.error("[Azure] Token refresh failed:", result.data)
          resolve(null)
        } else {
          resolve(result.data as TokenResponse)
        }
      } catch (err) {
        clearTimeout(timeout)
        tokenWindow.destroy()
        console.error("[Azure] Token refresh error:", err)
        resolve(null)
      }
    })
  })
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

    // Generate state for CSRF protection
    const state = generateState()

    // Build authorization URL
    const authorizeUrl = new URL(`${authority}/oauth2/v2.0/authorize`)
    authorizeUrl.searchParams.set("client_id", clientId)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("redirect_uri", this.getRedirectUri())
    authorizeUrl.searchParams.set("scope", SCOPES.join(" "))
    authorizeUrl.searchParams.set("state", state)
    authorizeUrl.searchParams.set("code_challenge", challenge)
    authorizeUrl.searchParams.set("code_challenge_method", "S256")
    authorizeUrl.searchParams.set("response_mode", "query")

    console.log("[Azure] Starting PKCE flow...")
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
    console.log("[Azure] Exchanging authorization code...")

    const { codeVerifier } = pkceState

    if (!codeVerifier) {
      throw new Error("No PKCE verifier found for token exchange")
    }

    // Use browser-based token exchange for SPA redirect URIs
    const tokenData = await exchangeCodeViaBrowser(code, codeVerifier, this.getRedirectUri())

    console.log("[Azure] Token exchange successful")

    if (!tokenData.id_token) {
      throw new Error("No id_token in response. Make sure 'openid' scope is requested.")
    }

    const user = parseIdToken(tokenData.id_token)

    return { tokenData, user }
  }

  async refresh(refreshToken: string): Promise<TokenResponse | null> {
    console.log("[Azure] Refreshing token...")

    const tokenData = await refreshTokenViaBrowser(refreshToken)

    if (tokenData) {
      console.log("[Azure] Token refreshed successfully")
    }

    return tokenData
  }

  parseIdToken(idToken: string): AuthUser {
    return parseIdToken(idToken)
  }
}
