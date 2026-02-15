/**
 * Device Information Module
 *
 * Provides comprehensive device information and generates a unique device identifier hash.
 * Used for device identification in lite communication and debugging.
 */

import * as os from "os"
import * as crypto from "crypto"
import { createLogger } from "./logger"

const deviceLog = createLogger("DeviceInfo")

export interface DeviceInfo {
  // System information
  platform: string           // darwin, win32, linux
  platformName: string       // macOS, Windows, Linux
  osVersion: string          // OS version string
  osRelease: string          // OS release version
  arch: string               // x64, arm64, etc.

  // Machine information
  hostname: string           // Computer name
  username: string           // Current user
  homeDir: string            // User home directory

  // Hardware information
  cpuModel: string           // CPU model name
  cpuCores: number           // Number of CPU cores
  totalMemory: number        // Total memory in bytes
  totalMemoryGB: string      // Total memory in GB (formatted)

  // Network information
  macAddress: string | null  // Primary MAC address (for device ID)
  networkInterfaces: string[] // List of network interface names

  // Device identifier
  deviceId: string           // Unique device identifier hash

  // Timestamps
  uptime: number             // System uptime in seconds
  timestamp: string          // Current timestamp
}

/**
 * Get primary MAC address from network interfaces
 * Used as part of device identification
 */
function getPrimaryMacAddress(): string | null {
  try {
    const interfaces = os.networkInterfaces()

    // Priority order: en0 (macOS), eth0 (Linux), Ethernet (Windows)
    const priorityNames = ['en0', 'eth0', 'Ethernet', 'Wi-Fi']

    // First try priority interfaces
    for (const name of priorityNames) {
      const iface = interfaces[name]
      if (iface) {
        for (const addr of iface) {
          if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
            return addr.mac
          }
        }
      }
    }

    // Fall back to first non-internal interface with valid MAC
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue
      for (const addr of addrs) {
        if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
          return addr.mac
        }
      }
    }

    return null
  } catch (error) {
    deviceLog.warn("Failed to get MAC address:", error)
    return null
  }
}

/**
 * Get platform display name
 */
function getPlatformName(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macOS"
    case "win32":
      return "Windows"
    case "linux":
      return "Linux"
    default:
      return platform
  }
}

/**
 * Format bytes to GB string
 */
function formatMemoryGB(bytes: number): string {
  return (bytes / (1024 ** 3)).toFixed(2) + " GB"
}

/**
 * Generate device identifier hash
 *
 * Uses a combination of:
 * - MAC address (if available)
 * - Hostname
 * - CPU model
 * - Platform
 * - Username
 *
 * This creates a stable identifier that persists across app restarts
 * but may change if hardware or network configuration changes.
 */
function generateDeviceId(macAddress: string | null, hostname: string, cpuModel: string, platform: string, username: string): string {
  const components = [
    macAddress || "no-mac",
    hostname,
    cpuModel,
    platform,
    username,
  ].join("|")

  return crypto
    .createHash("sha256")
    .update(components)
    .digest("hex")
}

/**
 * Get comprehensive device information
 */
export function getDeviceInfo(): DeviceInfo {
  const platform = process.platform
  const cpus = os.cpus()
  const macAddress = getPrimaryMacAddress()
  const hostname = os.hostname()
  const username = os.userInfo().username
  const cpuModel = cpus[0]?.model || "Unknown CPU"
  const totalMemory = os.totalmem()

  const deviceId = generateDeviceId(
    macAddress,
    hostname,
    cpuModel,
    platform,
    username
  )

  const interfaces = os.networkInterfaces()
  const networkInterfaceNames = Object.keys(interfaces).filter(name => {
    const addrs = interfaces[name]
    return addrs && addrs.some(addr => !addr.internal)
  })

  return {
    // System
    platform,
    platformName: getPlatformName(platform),
    osVersion: os.version(),
    osRelease: os.release(),
    arch: process.arch,

    // Machine
    hostname,
    username,
    homeDir: os.homedir(),

    // Hardware
    cpuModel,
    cpuCores: cpus.length,
    totalMemory,
    totalMemoryGB: formatMemoryGB(totalMemory),

    // Network
    macAddress,
    networkInterfaces: networkInterfaceNames,

    // Device ID
    deviceId,

    // Timestamps
    uptime: os.uptime(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Serialize device info to a single line string
 * Format: platform|hostname|deviceId|timestamp
 *
 * This compact format is useful for logging or network transmission.
 */
export function serializeDeviceInfo(info: DeviceInfo): string {
  return [
    info.platformName,
    info.hostname,
    info.deviceId,
    info.timestamp,
  ].join("|")
}

/**
 * Get device identifier hash only (lightweight)
 *
 * Use this when you only need the device ID without
 * fetching all device information.
 */
export function getDeviceId(): string {
  const macAddress = getPrimaryMacAddress()
  const hostname = os.hostname()
  const cpuModel = os.cpus()[0]?.model || "Unknown CPU"
  const platform = process.platform
  const username = os.userInfo().username

  return generateDeviceId(macAddress, hostname, cpuModel, platform, username)
}
