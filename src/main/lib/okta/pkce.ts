/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0
 * Used for secure authorization code flow in public clients (desktop apps)
 */
import { randomBytes, createHash } from "crypto"

/**
 * Generate a cryptographically random code verifier
 * Must be 43-128 characters, using unreserved URI characters
 */
export function generateCodeVerifier(): string {
  // 32 bytes = 43 base64url characters
  return randomBytes(32).toString("base64url")
}

/**
 * Generate code challenge from verifier using S256 method
 * SHA256 hash, then base64url encode
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

/**
 * Generate a random state parameter to prevent CSRF attacks
 */
export function generateState(): string {
  return randomBytes(16).toString("base64url")
}
