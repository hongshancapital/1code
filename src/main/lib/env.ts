/**
 * Environment variable validation and access
 *
 * All environment variables are injected at build time via Vite's import.meta.env.
 * This module validates that required variables are set and provides typed access.
 */

/**
 * Required environment variables (app will fail to start without these)
 */
interface RequiredEnv {
  // Okta OAuth (authentication)
  MAIN_VITE_OKTA_ISSUER: string
  MAIN_VITE_OKTA_CLIENT_ID: string
  // Note: OKTA_CALLBACK is auto-generated based on dev/production mode (port 3300/3000)

  // API configuration
  MAIN_VITE_API_URL: string
  MAIN_VITE_API_ORIGIN: string
}

/**
 * Optional environment variables (app works without these)
 */
interface OptionalEnv {
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
 * Throws error if required variables are missing.
 */
export function validateEnv(): Env {
  if (validatedEnv) {
    return validatedEnv
  }

  const missing: string[] = []

  // Check required variables
  const requiredVars: (keyof RequiredEnv)[] = [
    "MAIN_VITE_OKTA_ISSUER",
    "MAIN_VITE_OKTA_CLIENT_ID",
    "MAIN_VITE_API_URL",
    "MAIN_VITE_API_ORIGIN",
  ]

  for (const key of requiredVars) {
    const value = import.meta.env[key]
    if (!value || value.trim() === "") {
      missing.push(key)
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables:\n${missing.map((v) => `  - ${v}`).join("\n")}\n\nPlease set these in your .env file before building.`
    console.error(`[Env] ${message}`)
    throw new Error(message)
  }

  // Build validated env object
  validatedEnv = {
    // Required
    MAIN_VITE_OKTA_ISSUER: import.meta.env.MAIN_VITE_OKTA_ISSUER!,
    MAIN_VITE_OKTA_CLIENT_ID: import.meta.env.MAIN_VITE_OKTA_CLIENT_ID!,
    MAIN_VITE_API_URL: import.meta.env.MAIN_VITE_API_URL!,
    MAIN_VITE_API_ORIGIN: import.meta.env.MAIN_VITE_API_ORIGIN!,

    // Optional
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
 */
export function getApiOrigin(): string {
  return getEnv().MAIN_VITE_API_ORIGIN
}
