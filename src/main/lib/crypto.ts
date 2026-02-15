/**
 * Token 加解密工具
 *
 * 使用 Electron safeStorage 加解密 OAuth token。
 * 全局唯一实现，消除各 router 中的重复定义。
 */

import { safeStorage } from "electron"

/**
 * Encrypt a token string using Electron's safeStorage.
 * Falls back to plain base64 when encryption is unavailable.
 */
export function encryptToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[crypto] Encryption not available, storing as base64")
    return Buffer.from(token).toString("base64")
  }
  return safeStorage.encryptString(token).toString("base64")
}

/**
 * Decrypt a base64-encoded token using Electron's safeStorage.
 * Falls back to plain base64 decode when encryption is unavailable.
 */
export function decryptToken(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(encrypted, "base64").toString("utf-8")
  }
  const buffer = Buffer.from(encrypted, "base64")
  return safeStorage.decryptString(buffer)
}
