/**
 * Environment variable validation and access for Renderer Process
 *
 * All environment variables are injected at build time via Vite's import.meta.env.
 * This module validates that required variables are set and provides typed access.
 */
import { createLogger } from "./logger"

const envLog = createLogger("Env")

/**
 * Environment variables for renderer (all optional)
 */
interface Env {
  // Analytics (disabled if not set)
  VITE_SENSORS_SERVER_URL?: string

  // Feedback URL
  VITE_FEEDBACK_URL?: string
}

// Cached validated environment
let validatedEnv: Env | null = null

/**
 * Validate and cache environment variables.
 * Should be called early in app startup.
 * Renderer has no required env vars currently.
 */
export function validateEnv(): Env {
  if (validatedEnv) {
    return validatedEnv
  }

  // Build env object (all optional for renderer)
  validatedEnv = {
    VITE_SENSORS_SERVER_URL: import.meta.env.VITE_SENSORS_SERVER_URL,
    VITE_FEEDBACK_URL: import.meta.env.VITE_FEEDBACK_URL,
  }

  envLog.info("Renderer environment loaded")
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
