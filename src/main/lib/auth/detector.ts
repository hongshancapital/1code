/**
 * Auth Provider Detector
 *
 * Detects which authentication provider to use based on Windows domain.
 * On Windows, if USERDNSDOMAIN ends with "hongshan.cn", use Azure AD.
 * Otherwise, use Okta.
 */

import { AuthProviderType } from "./types"

/**
 * Detect which auth provider to use based on environment.
 *
 * Rules:
 * - Non-Windows: Always Okta
 * - Windows with USERDNSDOMAIN ending with "hongshan.cn": Azure AD
 * - Windows otherwise: Okta
 */
export function detectAuthProvider(): AuthProviderType {
  // Only check domain on Windows
  if (process.platform !== "win32") {
    console.log("[Auth Detector] Non-Windows platform, using Okta")
    return "okta"
  }

  const userDnsDomain = (process.env.USERDNSDOMAIN || "").toLowerCase().trim()

  console.log("[Auth Detector] Windows detected")
  console.log("[Auth Detector] USERDNSDOMAIN:", userDnsDomain || "(not set)")

  // Check if USERDNSDOMAIN ends with hongshancap.cn
  if (userDnsDomain.endsWith("hongshancap.cn")) {
    console.log("[Auth Detector] USERDNSDOMAIN ends with hongshancap.cn, using Azure AD")
    return "azure"
  }

  console.log("[Auth Detector] No Azure domain match, using Okta")
  return "okta"
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
 * Get effective auth provider, falling back to Okta if Azure is detected but not configured
 */
export function getEffectiveAuthProvider(): AuthProviderType {
  const detected = detectAuthProvider()

  if (detected === "azure" && !isAzureConfigured()) {
    console.warn("[Auth Detector] Azure AD detected but not configured, falling back to Okta")
    return "okta"
  }

  return detected
}
