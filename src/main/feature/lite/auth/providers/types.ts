/**
 * Auth Provider Types
 *
 * Common interfaces for Okta and Azure AD authentication providers.
 */

import { BrowserWindow } from "electron"

/**
 * Supported authentication providers
 * - "okta": Okta OAuth (default)
 * - "azure": Azure AD (for Windows domain users)
 * - "none": No authentication required (fallback when no provider is configured)
 */
export type AuthProviderType = "okta" | "azure" | "none"

/**
 * User information from authentication
 */
export interface AuthUser {
  id: string
  email: string
  name: string | null
  imageUrl: string | null
  username: string | null
}

/**
 * Complete authentication data
 */
export interface AuthData {
  token: string
  refreshToken: string
  idToken?: string
  expiresAt: string
  user: AuthUser
  provider: AuthProviderType
}

/**
 * Token response from OAuth provider
 */
export interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
  token_type: string
}

/**
 * PKCE state for ongoing auth flow
 */
export interface PkceState {
  codeVerifier: string
  state: string
  provider: AuthProviderType
}

/**
 * Authentication provider interface
 */
export interface AuthProvider {
  /**
   * Provider name for logging and identification
   */
  readonly name: AuthProviderType

  /**
   * Start the OAuth authorization flow
   */
  startAuthFlow(window: BrowserWindow | null): PkceState

  /**
   * Exchange authorization code for tokens
   */
  exchangeCode(code: string, pkceState: PkceState): Promise<{
    tokenData: TokenResponse
    user: AuthUser
  }>

  /**
   * Refresh access token using refresh token
   */
  refresh(refreshToken: string): Promise<TokenResponse | null>

  /**
   * Get the redirect URI for this provider
   */
  getRedirectUri(): string

  /**
   * Parse user info from id_token
   */
  parseIdToken(idToken: string): AuthUser
}
