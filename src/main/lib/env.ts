/**
 * Environment variable validation and access
 *
 * All environment variables are injected at build time via Vite's import.meta.env.
 * This module validates that required variables are set and provides typed access.
 */

/**
 * Required environment variables (app will fail to start without these)
 * Note: Currently empty - all auth-related vars are now optional for graceful degradation
 */
interface RequiredEnv {
  // No required variables - app can run in "no-auth" mode
}

/**
 * Optional environment variables (app works without these)
 */
interface OptionalEnv {
  // Okta OAuth (authentication) - if not set, falls back to no-auth mode
  MAIN_VITE_OKTA_ISSUER?: string
  MAIN_VITE_OKTA_CLIENT_ID?: string
  // Note: OKTA_CALLBACK is auto-generated based on dev/production mode (port 3300/3000)

  // API configuration - required for authenticated API calls
  MAIN_VITE_API_URL?: string
  MAIN_VITE_API_ORIGIN?: string

  // Sentry error tracking (production only)
  MAIN_VITE_SENTRY_DSN?: string

  // Voice input
  MAIN_VITE_OPENAI_API_KEY?: string

  // Analytics (disabled if not set)
  MAIN_VITE_SENSORS_SERVER_URL?: string

  // LiteLLM proxy (internal use)
  MAIN_VITE_LITELLM_BASE_URL?: string
  MAIN_VITE_LITELLM_API_KEY?: string

  // Azure AD OAuth (Windows domain users)
  // Required for Windows machines joined to hongshan.cn domain
  MAIN_VITE_AZURE_TENANT_ID?: string
  MAIN_VITE_AZURE_CLIENT_ID?: string
  // Azure AD login URL (e.g., https://login.partner.microsoftonline.cn for China)
  MAIN_VITE_AZURE_LOGIN_URL?: string
}

/**
 * All environment variables
 */
type Env = RequiredEnv & OptionalEnv

// Cached validated environment
let validatedEnv: Env | null = null

/**
 * Validate and cache environment variables.
 * Should be called early in app startup.
 * All auth variables are optional - app will run in "no-auth" mode if not configured.
 */
export function validateEnv(): Env {
  if (validatedEnv) {
    return validatedEnv
  }

  // Log warnings for missing auth configuration
  const authVars = [
    "MAIN_VITE_OKTA_ISSUER",
    "MAIN_VITE_OKTA_CLIENT_ID",
    "MAIN_VITE_API_URL",
    "MAIN_VITE_API_ORIGIN",
  ] as const

  const missingAuthVars = authVars.filter((key) => {
    const value = import.meta.env[key]
    return !value || value.trim() === ""
  })

  if (missingAuthVars.length > 0) {
    console.warn(
      `[Env] Auth configuration incomplete. Missing: ${missingAuthVars.join(", ")}. App will run in no-auth mode.`
    )
  }

  // Build validated env object - all values are optional
  validatedEnv = {
    // Auth configuration (optional - for graceful degradation)
    MAIN_VITE_OKTA_ISSUER: import.meta.env.MAIN_VITE_OKTA_ISSUER,
    MAIN_VITE_OKTA_CLIENT_ID: import.meta.env.MAIN_VITE_OKTA_CLIENT_ID,
    MAIN_VITE_API_URL: import.meta.env.MAIN_VITE_API_URL,
    MAIN_VITE_API_ORIGIN: import.meta.env.MAIN_VITE_API_ORIGIN,

    // Optional features
    MAIN_VITE_SENTRY_DSN: import.meta.env.MAIN_VITE_SENTRY_DSN,
    MAIN_VITE_OPENAI_API_KEY: import.meta.env.MAIN_VITE_OPENAI_API_KEY,
    MAIN_VITE_SENSORS_SERVER_URL: import.meta.env.MAIN_VITE_SENSORS_SERVER_URL,
    MAIN_VITE_LITELLM_BASE_URL: import.meta.env.MAIN_VITE_LITELLM_BASE_URL,
    MAIN_VITE_LITELLM_API_KEY: import.meta.env.MAIN_VITE_LITELLM_API_KEY,

    // Azure AD (optional, for Windows domain users)
    MAIN_VITE_AZURE_TENANT_ID: import.meta.env.MAIN_VITE_AZURE_TENANT_ID,
    MAIN_VITE_AZURE_CLIENT_ID: import.meta.env.MAIN_VITE_AZURE_CLIENT_ID,
    MAIN_VITE_AZURE_LOGIN_URL: import.meta.env.MAIN_VITE_AZURE_LOGIN_URL,
  }

  console.log("[Env] Environment validated successfully")
  return validatedEnv
}

/**
 * Get validated environment variables.
 * Throws if validateEnv() hasn't been called yet.
 */
export function getEnv(): Env {
  if (!validatedEnv) {
    throw new Error("[Env] Environment not validated. Call validateEnv() first.")
  }
  return validatedEnv
}

/**
 * Get API Origin for CORS headers.
 * Returns undefined in no-auth mode.
 */
export function getApiOrigin(): string | undefined {
  return getEnv().MAIN_VITE_API_ORIGIN
}
