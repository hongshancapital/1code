/**
 * Runtime Provider Factory
 *
 * Creates platform-specific runtime providers
 */

import type { RuntimeProvider, SupportedPlatform } from "./types"
import { WindowsRuntimeProvider } from "./windows-provider"
import { MacOSRuntimeProvider } from "./macos-provider"
import { LinuxRuntimeProvider } from "./linux-provider"

/**
 * Create a runtime provider for the current platform
 */
export function createRuntimeProvider(
  platform: NodeJS.Platform = process.platform
): RuntimeProvider {
  switch (platform) {
    case "win32":
      return new WindowsRuntimeProvider()
    case "darwin":
      return new MacOSRuntimeProvider()
    case "linux":
      return new LinuxRuntimeProvider()
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

/**
 * Get platform-specific provider singleton
 */
let providerInstance: RuntimeProvider | null = null

export function getRuntimeProvider(): RuntimeProvider {
  if (!providerInstance) {
    providerInstance = createRuntimeProvider()
  }
  return providerInstance
}

/**
 * Reset provider instance (for testing)
 */
export function resetRuntimeProvider(): void {
  providerInstance = null
}
