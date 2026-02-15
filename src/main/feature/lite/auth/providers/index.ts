/**
 * Auth Module
 *
 * Exports authentication providers and utilities.
 * Supports "none" mode for running without authentication.
 */

export * from "./types"
export * from "./detector"
export { OktaProvider } from "./okta-provider"
export { AzureProvider } from "./azure-provider"

import type { AuthProvider, AuthProviderType } from "./types"
import { getEffectiveAuthProvider } from "./detector"
import { OktaProvider } from "./okta-provider"
import { AzureProvider } from "./azure-provider"

// Cached provider instances
let oktaProvider: OktaProvider | null = null
let azureProvider: AzureProvider | null = null

/**
 * Get the auth provider instance for the given type.
 * Returns null for "none" type (no-auth mode).
 */
export function getProvider(type: AuthProviderType): AuthProvider | null {
  if (type === "none") {
    return null
  }

  if (type === "azure") {
    if (!azureProvider) {
      azureProvider = new AzureProvider()
    }
    return azureProvider
  }

  if (!oktaProvider) {
    oktaProvider = new OktaProvider()
  }
  return oktaProvider
}

/**
 * Get the effective auth provider based on current environment.
 * Returns null if running in no-auth mode.
 */
export function getCurrentProvider(): AuthProvider | null {
  const type = getEffectiveAuthProvider()
  return getProvider(type)
}

/**
 * Check if authentication is required (i.e., not in "none" mode)
 */
export function isAuthRequired(): boolean {
  return getEffectiveAuthProvider() !== "none"
}
