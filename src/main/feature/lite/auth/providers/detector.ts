/**
 * Auth Provider Detector
 *
 * Detects which authentication provider to use based on Windows domain and configuration.
 * Supports graceful degradation to "none" (no-auth) mode when no provider is configured.
 *
 * Priority:
 * 1. Windows with USERDNSDOMAIN ending with "hongshancap.cn" + Azure configured → Azure AD
 * 2. Okta configured → Okta
 * 3. Neither configured → "none" (no authentication required)
 */

import type { AuthProviderType } from "./types"
import { createLogger } from "../../../../lib/logger"

const log = createLogger("detector")


/**
 * Check if Okta configuration is available
 */
export function isOktaConfigured(): boolean {
  const issuer = import.meta.env.MAIN_VITE_OKTA_ISSUER
  const clientId = import.meta.env.MAIN_VITE_OKTA_CLIENT_ID

  return !!(issuer && clientId)
}

/**
 * Check if Azure AD configuration is available
 */
export function isAzureConfigured(): boolean {
  const tenantId = import.meta.env.MAIN_VITE_AZURE_TENANT_ID
  const clientId = import.meta.env.MAIN_VITE_AZURE_CLIENT_ID
  const loginUrl = import.meta.env.MAIN_VITE_AZURE_LOGIN_URL

  return !!(tenantId && clientId && loginUrl)
}

/**
 * Check if any authentication provider is configured
 */
export function isAuthConfigured(): boolean {
  return isOktaConfigured() || isAzureConfigured()
}

/**
 * Detect which auth provider to use based on environment.
 *
 * Rules:
 * - Non-Windows: Always Okta (if configured)
 * - Windows with USERDNSDOMAIN ending with "hongshancap.cn": Azure AD (if configured)
 * - Windows otherwise: Okta (if configured)
 * - No provider configured: "none"
 */
export function detectAuthProvider(): AuthProviderType {
  // Only check domain on Windows
  if (process.platform !== "win32") {
    log.info("[Auth Detector] Non-Windows platform, preferring Okta")
    return "okta"
  }

  const userDnsDomain = (process.env.USERDNSDOMAIN || "").toLowerCase().trim()

  log.info("[Auth Detector] Windows detected")
  log.info("[Auth Detector] USERDNSDOMAIN:", userDnsDomain || "(not set)")

  // Check if USERDNSDOMAIN ends with hongshancap.cn
  if (userDnsDomain.endsWith("hongshancap.cn")) {
    log.info("[Auth Detector] USERDNSDOMAIN ends with hongshancap.cn, preferring Azure AD")
    return "azure"
  }

  log.info("[Auth Detector] No Azure domain match, preferring Okta")
  return "okta"
}

/**
 * Get effective auth provider with graceful degradation.
 *
 * Fallback chain:
 * 1. If Azure is detected and configured → Azure
 * 2. If Azure is detected but not configured, and Okta is configured → Okta
 * 3. If Okta is preferred and configured → Okta
 * 4. If Okta is preferred but not configured, and Azure is configured → Azure
 * 5. If neither is configured → "none" (no-auth mode)
 */
export function getEffectiveAuthProvider(): AuthProviderType {
  const detected = detectAuthProvider()

  // Check if detected provider is configured
  if (detected === "azure") {
    if (isAzureConfigured()) {
      log.info("[Auth Detector] Using Azure AD (configured)")
      return "azure"
    }
    // Fallback to Okta if available
    if (isOktaConfigured()) {
      log.warn("[Auth Detector] Azure AD detected but not configured, falling back to Okta")
      return "okta"
    }
  } else if (detected === "okta") {
    if (isOktaConfigured()) {
      log.info("[Auth Detector] Using Okta (configured)")
      return "okta"
    }
    // Fallback to Azure if available
    if (isAzureConfigured()) {
      log.warn("[Auth Detector] Okta preferred but not configured, falling back to Azure AD")
      return "azure"
    }
  }

  // No provider configured - run in no-auth mode
  log.warn("[Auth Detector] No authentication provider configured, running in no-auth mode")
  return "none"
}
