/**
 * Auth Module
 *
 * Exports authentication providers and utilities.
 */

export * from "./types"
export * from "./detector"
export { OktaProvider } from "./okta-provider"
export { AzureProvider } from "./azure-provider"

import { AuthProvider, AuthProviderType } from "./types"
import { getEffectiveAuthProvider } from "./detector"
import { OktaProvider } from "./okta-provider"
import { AzureProvider } from "./azure-provider"

// Cached provider instances
let oktaProvider: OktaProvider | null = null
let azureProvider: AzureProvider | null = null

/**
 * Get the auth provider instance for the given type
 */
export function getProvider(type: AuthProviderType): AuthProvider {
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
 * Get the effective auth provider based on current environment
 */
export function getCurrentProvider(): AuthProvider {
  const type = getEffectiveAuthProvider()
  return getProvider(type)
}
