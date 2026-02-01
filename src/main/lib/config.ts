/**
 * Shared configuration for the desktop app
 */
import { getEnv } from "./env"

const IS_DEV = !!process.env.ELECTRON_RENDERER_URL

/**
 * Get the API base URL from validated environment
 */
export function getApiUrl(): string {
  return getEnv().MAIN_VITE_API_URL
}

/**
 * Check if running in development mode
 */
export function isDev(): boolean {
  return IS_DEV
}
