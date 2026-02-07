import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { safeStorage } from "electron"

export interface AuthUser {
  id: string
  email: string
  name: string | null
  imageUrl: string | null
  username: string | null
}

/**
 * Supported authentication providers
 * - "okta": Okta OAuth (default)
 * - "azure": Azure AD (for Windows domain users)
 * - "none": No authentication required (fallback when no provider is configured)
 */
export type AuthProviderType = "okta" | "azure" | "none"

export interface AuthData {
  token: string
  refreshToken: string
  idToken?: string // OAuth id_token for user info
  expiresAt: string
  user: AuthUser
  provider?: AuthProviderType // Which auth provider was used (defaults to "okta" for backwards compat)
}

/**
 * Storage for desktop authentication tokens
 * Uses Electron's safeStorage API to encrypt sensitive data using OS keychain
 * Falls back to plaintext only if encryption is unavailable (rare edge case)
 */
export class AuthStore {
  private filePath: string
  private skipFilePath: string

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "auth.dat") // .dat for encrypted data
    this.skipFilePath = join(userDataPath, "auth-skipped.json")
  }

  /**
   * Check if encryption is available on this system
   */
  private isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /**
   * Save authentication data (encrypted if possible)
   */
  save(data: AuthData): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const jsonData = JSON.stringify(data)
      
      if (this.isEncryptionAvailable()) {
        // Encrypt using OS keychain (macOS Keychain, Windows DPAPI, Linux Secret Service)
        const encrypted = safeStorage.encryptString(jsonData)
        writeFileSync(this.filePath, encrypted)
      } else {
        // Fallback: store with warning (should rarely happen)
        console.warn("safeStorage not available - storing auth data without encryption")
        writeFileSync(this.filePath + ".json", jsonData, "utf-8")
      }
    } catch (error) {
      console.error("Failed to save auth data:", error)
      throw error
    }
  }

  /**
   * Load authentication data (decrypts if encrypted)
   */
  load(): AuthData | null {
    try {
      // Try encrypted file first
      if (existsSync(this.filePath) && this.isEncryptionAvailable()) {
        const encrypted = readFileSync(this.filePath)
        const decrypted = safeStorage.decryptString(encrypted)
        return JSON.parse(decrypted)
      }
      
      // Fallback: try unencrypted file (for migration or when encryption unavailable)
      const fallbackPath = this.filePath + ".json"
      if (existsSync(fallbackPath)) {
        const content = readFileSync(fallbackPath, "utf-8")
        const data = JSON.parse(content)
        
        // Migrate to encrypted storage if now available
        if (this.isEncryptionAvailable()) {
          this.save(data)
          unlinkSync(fallbackPath) // Remove unencrypted file after migration
        }
        
        return data
      }
      
      // Legacy: check for old auth.json file and migrate
      const legacyPath = join(dirname(this.filePath), "auth.json")
      if (existsSync(legacyPath)) {
        const content = readFileSync(legacyPath, "utf-8")
        const data = JSON.parse(content)
        
        // Migrate to encrypted storage
        this.save(data)
        unlinkSync(legacyPath) // Remove legacy unencrypted file
        console.log("Migrated auth data from plaintext to encrypted storage")
        
        return data
      }

      return null
    } catch {
      console.error("Failed to load auth data")
      return null
    }
  }

  /**
   * Clear all stored authentication data (both encrypted and fallback files)
   */
  clear(): void {
    try {
      // Remove encrypted file
      if (existsSync(this.filePath)) {
        unlinkSync(this.filePath)
      }
      // Remove fallback unencrypted file if exists
      const fallbackPath = this.filePath + ".json"
      if (existsSync(fallbackPath)) {
        unlinkSync(fallbackPath)
      }
      // Remove legacy file if exists
      const legacyPath = join(dirname(this.filePath), "auth.json")
      if (existsSync(legacyPath)) {
        unlinkSync(legacyPath)
      }
    } catch (error) {
      console.error("Failed to clear auth data:", error)
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const data = this.load()
    if (!data) return false

    // Check if token is expired
    const expiresAt = new Date(data.expiresAt).getTime()
    return expiresAt > Date.now()
  }

  /**
   * Get current user if authenticated
   */
  getUser(): AuthUser | null {
    const data = this.load()
    return data?.user ?? null
  }

  /**
   * Get current token if valid
   */
  getToken(): string | null {
    const data = this.load()
    if (!data) return null

    const expiresAt = new Date(data.expiresAt).getTime()
    if (expiresAt <= Date.now()) return null

    return data.token
  }

  /**
   * Get refresh token
   */
  getRefreshToken(): string | null {
    const data = this.load()
    return data?.refreshToken ?? null
  }

  /**
   * Get auth provider type used for this session
   */
  getProvider(): AuthProviderType {
    const data = this.load()
    return data?.provider ?? "okta" // Default to okta for backwards compatibility
  }

  /**
   * Check if token needs refresh (expires in less than 5 minutes)
   */
  needsRefresh(): boolean {
    const data = this.load()
    if (!data) return false

    const expiresAt = new Date(data.expiresAt).getTime()
    const fiveMinutes = 5 * 60 * 1000
    return expiresAt - Date.now() < fiveMinutes
  }

  /**
   * Update user data (e.g., after profile update)
   */
  updateUser(updates: Partial<AuthUser>): AuthUser | null {
    const data = this.load()
    if (!data) return null

    data.user = { ...data.user, ...updates }
    this.save(data)
    return data.user
  }

  /**
   * Save auth skipped state
   */
  saveSkipped(skipped: boolean): void {
    try {
      const dir = dirname(this.skipFilePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.skipFilePath, JSON.stringify({ skipped }), "utf-8")
    } catch (error) {
      console.error("Failed to save auth skipped state:", error)
    }
  }

  /**
   * Check if auth was skipped
   */
  isSkipped(): boolean {
    try {
      if (existsSync(this.skipFilePath)) {
        const content = readFileSync(this.skipFilePath, "utf-8")
        const data = JSON.parse(content)
        return data.skipped === true
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * Clear skipped state (called when user logs in)
   */
  clearSkipped(): void {
    try {
      if (existsSync(this.skipFilePath)) {
        unlinkSync(this.skipFilePath)
      }
    } catch (error) {
      console.error("Failed to clear auth skipped state:", error)
    }
  }

  /**
   * Check if there's saved auth data (even if access token expired)
   * Used to determine if we should try refresh or auto-login for returning users
   */
  hasSavedAuth(): boolean {
    const data = this.load()
    return data !== null && !!data.refreshToken
  }
}
