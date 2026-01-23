import { app } from "electron"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { randomUUID } from "crypto"

/**
 * Device ID module - generates and persists a unique device identifier
 *
 * Used for:
 * - Identifying the device to backend APIs (replacing x-desktop-token)
 * - Tracking usage per device for billing/rate limiting
 * - Future: associating with Okta user identity
 */

let cachedDeviceId: string | null = null

/**
 * Get the path to the device ID file
 */
function getDeviceIdPath(): string {
  return join(app.getPath("userData"), "device-id")
}

/**
 * Generate a new device ID (UUID v4)
 */
function generateDeviceId(): string {
  return randomUUID()
}

/**
 * Get or create a persistent device ID
 *
 * The device ID is stored in the app's userData directory and persists
 * across app restarts. It's generated once on first launch.
 */
export function getDeviceId(): string {
  // Return cached value if available
  if (cachedDeviceId) {
    return cachedDeviceId
  }

  const deviceIdPath = getDeviceIdPath()

  // Try to read existing device ID
  if (existsSync(deviceIdPath)) {
    try {
      const storedId = readFileSync(deviceIdPath, "utf-8").trim()
      if (storedId) {
        cachedDeviceId = storedId
        return storedId
      }
    } catch (error) {
      console.warn("[DeviceId] Failed to read device ID file:", error)
    }
  }

  // Generate new device ID
  const newDeviceId = generateDeviceId()

  // Persist to file
  try {
    const dir = dirname(deviceIdPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(deviceIdPath, newDeviceId, "utf-8")
    console.log("[DeviceId] Generated new device ID")
  } catch (error) {
    console.error("[DeviceId] Failed to persist device ID:", error)
  }

  cachedDeviceId = newDeviceId
  return newDeviceId
}

/**
 * Get device info for API requests
 */
export function getDeviceInfo(): {
  deviceId: string
  platform: string
  arch: string
  appVersion: string
} {
  return {
    deviceId: getDeviceId(),
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
  }
}
