import { useState, useEffect, useRef } from "react"
import type {
  UploadedImage,
  UploadedFile,
} from "../hooks/use-agents-file-upload"
import type { SelectedTextContext, DiffTextContext } from "./queue-utils"
import { trpcClient } from "../../../lib/trpc"
import { createLogger } from "../../../lib/logger"

const draftsLog = createLogger("drafts")


// Constants
export const DRAFTS_STORAGE_KEY = "agent-drafts-global"
export const DRAFT_ID_PREFIX = "draft-"
export const DRAFTS_CHANGE_EVENT = "drafts-changed"
const MAX_DRAFT_STORAGE_BYTES = 4 * 1024 * 1024 // 4MB safe limit

// Track blob URLs for cleanup (prevents memory leaks)
const draftBlobUrls = new Map<string, string[]>()

// ===== In-memory cache layer =====
// Eliminates redundant JSON.parse on every loadGlobalDrafts() call.
// NOTE: loadGlobalDrafts() returns the cached reference directly.
// Callers that mutate the returned object and then call saveGlobalDrafts()
// are working on the same reference — this is intentional and matches all
// current call-sites (load → mutate → save).
let _cachedDrafts: GlobalDraftsRaw | null = null
let _pendingFlush: ReturnType<typeof setTimeout> | number | null = null
let _isDirty = false
let _cachedSize: number | null = null

function ensureCache(): GlobalDraftsRaw {
  if (_cachedDrafts === null) {
    try {
      const stored = localStorage.getItem(DRAFTS_STORAGE_KEY)
      _cachedDrafts = stored ? JSON.parse(stored) : {}
    } catch {
      _cachedDrafts = {}
    }
  }
  return _cachedDrafts!
}

function flushToStorage(): void {
  _pendingFlush = null
  if (!_isDirty || !_cachedDrafts) return
  _isDirty = false
  try {
    const serialized = JSON.stringify(_cachedDrafts)
    _cachedSize = serialized.length * 2
    localStorage.setItem(DRAFTS_STORAGE_KEY, serialized)
  } catch (e) {
    draftsLog.warn("Failed to flush to localStorage:", e)
  }
}

function scheduleFlush(): void {
  if (_pendingFlush !== null) return // already scheduled
  if (typeof requestIdleCallback === "function") {
    _pendingFlush = requestIdleCallback(() => flushToStorage(), { timeout: 1000 })
  } else {
    _pendingFlush = setTimeout(() => flushToStorage(), 100)
  }
}

/** Force synchronous flush — call on beforeunload / component unmount */
export function flushDraftsSync(): void {
  if (_pendingFlush !== null) {
    if (typeof cancelIdleCallback === "function" && typeof _pendingFlush === "number") {
      cancelIdleCallback(_pendingFlush)
    } else {
      clearTimeout(_pendingFlush as ReturnType<typeof setTimeout>)
    }
    _pendingFlush = null
  }
  flushToStorage()
}

/** Get cached byte-size of all drafts (avoids repeated JSON.stringify) */
export function getCachedDraftsSize(): number {
  if (_cachedSize !== null) return _cachedSize
  const drafts = ensureCache()
  _cachedSize = JSON.stringify(drafts).length * 2
  return _cachedSize
}

// Flush pending writes before page unload; invalidate cache on cross-tab changes
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => flushDraftsSync())
  window.addEventListener("storage", (e) => {
    if (e.key === DRAFTS_STORAGE_KEY) {
      _cachedDrafts = null
      _cachedSize = null
    }
  })
}

// Types for persisted attachments (new format: tempPath reference)
export interface DraftImage {
  id: string
  filename: string
  tempPath?: string      // disk temp file path (preferred)
  base64Data?: string    // legacy fallback (inline base64)
  mediaType: string
}

export interface DraftFile {
  id: string
  filename: string
  tempPath?: string      // disk temp file path (preferred)
  base64Data?: string    // legacy fallback (inline base64)
  size?: number
  type?: string
}

export interface DraftTextContext {
  id: string
  text: string
  sourceMessageId: string
  preview: string
  createdAt: string // ISO string instead of Date
}

export interface DraftDiffTextContext {
  id: string
  text: string
  filePath: string
  lineNumber?: number
  lineType?: "old" | "new"
  preview: string
  createdAt: string // ISO string instead of Date
  comment?: string
}

// Types
export interface DraftContent {
  text: string
  updatedAt: number
  images?: DraftImage[]
  files?: DraftFile[]
  textContexts?: DraftTextContext[]
  diffTextContexts?: DraftDiffTextContext[]
}

export interface DraftProject {
  id: string
  name: string
  path: string
  gitOwner?: string | null
  gitRepo?: string | null
  gitProvider?: string | null
}

export interface NewChatDraft {
  id: string
  text: string
  updatedAt: number
  project?: DraftProject
  isVisible?: boolean // Only show in sidebar when user navigates away from the form
  images?: DraftImage[]
  files?: DraftFile[]
  textContexts?: DraftTextContext[]
  diffTextContexts?: DraftDiffTextContext[]
}

// SubChatDraft uses key format: "chatId:subChatId"
export type SubChatDraft = DraftContent

// Raw drafts from localStorage (mixed format)
type GlobalDraftsRaw = Record<string, DraftContent | NewChatDraft>

// Emit custom event when drafts change (for same-tab sync)
export function emitDraftsChanged(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(DRAFTS_CHANGE_EVENT))
}

// Load all drafts (returns in-memory cache; O(1) after first call)
export function loadGlobalDrafts(): GlobalDraftsRaw {
  if (typeof window === "undefined") return {}
  return ensureCache()
}

// Save all drafts (updates cache synchronously, flushes to localStorage asynchronously)
export function saveGlobalDrafts(drafts: GlobalDraftsRaw): void {
  if (typeof window === "undefined") return
  _cachedDrafts = drafts
  _isDirty = true
  _cachedSize = null // invalidate size cache
  emitDraftsChanged()
  scheduleFlush()
}

// Generate a new draft ID
export function generateDraftId(): string {
  return `${DRAFT_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// Check if a key is a new chat draft (starts with draft-)
export function isNewChatDraftKey(key: string): boolean {
  return key.startsWith(DRAFT_ID_PREFIX)
}

// Check if a key is a sub-chat draft (contains :)
export function isSubChatDraftKey(key: string): boolean {
  return key.includes(":")
}

// Get new chat drafts as sorted array (only visible ones)
export function getNewChatDrafts(): NewChatDraft[] {
  const globalDrafts = loadGlobalDrafts()
  return Object.entries(globalDrafts)
    .filter(([key]) => isNewChatDraftKey(key))
    .map(([id, data]) => ({
      id,
      text: (data as NewChatDraft).text || "",
      updatedAt: data.updatedAt || 0,
      project: (data as NewChatDraft).project,
      isVisible: (data as NewChatDraft).isVisible,
    }))
    .filter((draft) => draft.isVisible === true)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// Save a new chat draft
export function saveNewChatDraft(
  draftId: string,
  text: string,
  project?: DraftProject
): void {
  const globalDrafts = loadGlobalDrafts()
  if (text.trim()) {
    globalDrafts[draftId] = {
      text,
      updatedAt: Date.now(),
      ...(project && { project }),
    }
  } else {
    delete globalDrafts[draftId]
  }
  saveGlobalDrafts(globalDrafts)
}

// Delete a new chat draft
export function deleteNewChatDraft(draftId: string): void {
  const globalDrafts = loadGlobalDrafts()
  delete globalDrafts[draftId]
  saveGlobalDrafts(globalDrafts)
}

// Mark a draft as visible (called when user navigates away from the form)
export function markDraftVisible(draftId: string): void {
  const globalDrafts = loadGlobalDrafts()
  if (globalDrafts[draftId]) {
    ;(globalDrafts[draftId] as NewChatDraft).isVisible = true
    saveGlobalDrafts(globalDrafts)
  }
}

// Get sub-chat draft key
export function getSubChatDraftKey(chatId: string, subChatId: string): string {
  return `${chatId}:${subChatId}`
}

// Get sub-chat draft text
export function getSubChatDraft(chatId: string, subChatId: string): string | null {
  const globalDrafts = loadGlobalDrafts()
  const key = getSubChatDraftKey(chatId, subChatId)
  const draft = globalDrafts[key] as DraftContent | undefined
  return draft?.text || null
}

// Save sub-chat draft
export function saveSubChatDraft(
  chatId: string,
  subChatId: string,
  text: string
): void {
  const globalDrafts = loadGlobalDrafts()
  const key = getSubChatDraftKey(chatId, subChatId)
  if (text.trim()) {
    globalDrafts[key] = { text, updatedAt: Date.now() }
  } else {
    delete globalDrafts[key]
  }
  saveGlobalDrafts(globalDrafts)
}

// Clear sub-chat draft (also revokes any blob URLs and cleans up disk files)
export function clearSubChatDraft(chatId: string, subChatId: string): void {
  const globalDrafts = loadGlobalDrafts()
  const key = getSubChatDraftKey(chatId, subChatId)
  const draft = globalDrafts[key] as DraftContent | undefined

  // Revoke blob URLs for images and files before deleting
  if (draft?.images) {
    draft.images.forEach((img) => revokeDraftBlobUrls(img.id))
  }
  if (draft?.files) {
    draft.files.forEach((file) => revokeDraftBlobUrls(file.id))
  }

  delete globalDrafts[key]
  saveGlobalDrafts(globalDrafts)

  // Async cleanup of disk files (fire-and-forget)
  trpcClient.files.cleanupDraftAttachments
    .mutate({ draftKey: key })
    .catch((err) => draftsLog.warn("Failed to cleanup disk files:", err))
}

// Build drafts cache from localStorage (for sidebar display)
export function buildDraftsCache(): Record<string, string> {
  const globalDrafts = loadGlobalDrafts()
  const cache: Record<string, string> = {}
  for (const [key, value] of Object.entries(globalDrafts)) {
    if ((value as DraftContent)?.text) {
      cache[key] = (value as DraftContent).text
    }
  }
  return cache
}

/**
 * Hook to get new chat drafts with automatic updates
 * Uses custom events for same-tab sync and storage events for cross-tab sync
 */
export function useNewChatDrafts(): NewChatDraft[] {
  const [drafts, setDrafts] = useState<NewChatDraft[]>(() => getNewChatDrafts())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleChange = (e?: Event) => {
      // For storage events, only react to draft-related keys
      // This prevents re-renders when other localStorage keys change (e.g., sub-chat active state)
      if (e instanceof StorageEvent) {
        if (!e.key?.startsWith("new-chat-draft-")) {
          return
        }
      }

      // Debounce: sidebar doesn't need to reflect every keystroke
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        const newDrafts = getNewChatDrafts()
        // Only update state if drafts actually changed (compare by content)
        setDrafts((prev) => {
          if (prev.length !== newDrafts.length) return newDrafts
          const prevIds = prev.map((d) => d.id).sort().join(",")
          const newIds = newDrafts.map((d) => d.id).sort().join(",")
          if (prevIds !== newIds) return newDrafts
          // Also compare text content
          const prevTexts = prev.map((d) => `${d.id}:${d.text}`).sort().join("|")
          const newTexts = newDrafts.map((d) => `${d.id}:${d.text}`).sort().join("|")
          if (prevTexts !== newTexts) return newDrafts
          return prev // No change, return previous reference
        })
      }, 300)
    }

    // Listen for custom event (same-tab changes)
    window.addEventListener(DRAFTS_CHANGE_EVENT, handleChange)
    // Listen for storage event (cross-tab changes)
    window.addEventListener("storage", handleChange)

    return () => {
      window.removeEventListener(DRAFTS_CHANGE_EVENT, handleChange)
      window.removeEventListener("storage", handleChange)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return drafts
}

/**
 * Hook to get sub-chat drafts cache with automatic updates
 * Returns a Record<key, text> for quick lookups
 */
export function useSubChatDraftsCache(): Record<string, string> {
  const [draftsCache, setDraftsCache] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {}
    return buildDraftsCache()
  })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleChange = () => {
      // Debounce: sidebar doesn't need to reflect every keystroke
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        const newCache = buildDraftsCache()
        setDraftsCache(newCache)
      }, 300)
    }

    // Listen for custom event (same-tab changes)
    window.addEventListener(DRAFTS_CHANGE_EVENT, handleChange)
    // Listen for storage event (cross-tab changes)
    window.addEventListener("storage", handleChange)

    return () => {
      window.removeEventListener(DRAFTS_CHANGE_EVENT, handleChange)
      window.removeEventListener("storage", handleChange)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return draftsCache
}

/**
 * Hook to get a specific sub-chat draft
 */
export function useSubChatDraft(
  parentChatId: string | null,
  subChatId: string
): string | null {
  const draftsCache = useSubChatDraftsCache()

  if (!parentChatId) return null
  const key = getSubChatDraftKey(parentChatId, subChatId)
  return draftsCache[key] || null
}

// ============================================
// Attachment persistence utilities
// ============================================

/**
 * Estimate size of draft in bytes (for storage limit checks)
 */
export function estimateDraftSize(
  draft: DraftContent | NewChatDraft
): number {
  return JSON.stringify(draft).length * 2 // UTF-16 chars = 2 bytes each
}

/**
 * Check if adding a draft would exceed storage limits.
 * Uses getCachedDraftsSize() to avoid redundant JSON.stringify of the full drafts object.
 */
function wouldExceedStorageLimit(
  newDraft: DraftContent | NewChatDraft
): boolean {
  const existingSize = getCachedDraftsSize()
  const newSize = estimateDraftSize(newDraft)
  return existingSize + newSize > MAX_DRAFT_STORAGE_BYTES
}

/**
 * Convert blob URL to base64 data
 */
async function blobUrlToBase64(blobUrl: string): Promise<string> {
  const response = await fetch(blobUrl)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // Remove the data:xxx;base64, prefix
      const base64 = result.split(",")[1]
      resolve(base64 || "")
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Convert UploadedImage to DraftImage for persistence.
 * Prefers tempPath (lightweight), falls back to base64Data (legacy).
 */
export function toDraftImage(img: UploadedImage): DraftImage | null {
  if (!img.tempPath && !img.base64Data) return null
  return {
    id: img.id,
    filename: img.filename,
    ...(img.tempPath ? { tempPath: img.tempPath } : { base64Data: img.base64Data }),
    mediaType: img.mediaType || "image/png",
  }
}

/**
 * Convert UploadedFile to DraftFile for persistence (now synchronous).
 * Prefers tempPath (lightweight), falls back to base64Data if available.
 */
export function toDraftFile(file: UploadedFile): DraftFile | null {
  if (!file.tempPath) return null // files without tempPath cannot be persisted synchronously
  return {
    id: file.id,
    filename: file.filename,
    tempPath: file.tempPath,
    size: file.size,
    type: file.type,
  }
}

/**
 * Convert SelectedTextContext to DraftTextContext
 */
export function toDraftTextContext(
  ctx: SelectedTextContext
): DraftTextContext {
  return {
    id: ctx.id,
    text: ctx.text,
    sourceMessageId: ctx.sourceMessageId,
    preview: ctx.preview,
    createdAt:
      ctx.createdAt instanceof Date
        ? ctx.createdAt.toISOString()
        : String(ctx.createdAt),
  }
}

/**
 * Convert DiffTextContext to DraftDiffTextContext
 */
export function toDraftDiffTextContext(
  ctx: DiffTextContext
): DraftDiffTextContext {
  return {
    id: ctx.id,
    text: ctx.text,
    filePath: ctx.filePath,
    lineNumber: ctx.lineNumber,
    lineType: ctx.lineType,
    preview: ctx.preview,
    createdAt:
      ctx.createdAt instanceof Date
        ? ctx.createdAt.toISOString()
        : String(ctx.createdAt),
    comment: ctx.comment,
  }
}

/**
 * Revoke blob URLs associated with a draft item
 */
export function revokeDraftBlobUrls(draftId: string): void {
  const urls = draftBlobUrls.get(draftId)
  if (urls) {
    urls.forEach((url) => URL.revokeObjectURL(url))
    draftBlobUrls.delete(draftId)
  }
}

/**
 * Revoke all tracked blob URLs (call on unmount or cleanup)
 */
export function revokeAllDraftBlobUrls(): void {
  draftBlobUrls.forEach((urls) => {
    urls.forEach((url) => URL.revokeObjectURL(url))
  })
  draftBlobUrls.clear()
}

/**
 * Restore UploadedImage from DraftImage.
 * Supports both new format (tempPath → read from disk) and legacy format (inline base64).
 * Tracks blob URL for cleanup to prevent memory leaks.
 */
export async function fromDraftImage(draft: DraftImage): Promise<UploadedImage | null> {
  try {
    let base64Data: string | undefined
    let tempPath: string | undefined

    if (draft.tempPath) {
      // New format: read from disk
      const result = await trpcClient.files.readDraftAttachment.query({
        tempPath: draft.tempPath,
      })
      if (!result) return null
      base64Data = result.base64Data
      tempPath = draft.tempPath
    } else if (draft.base64Data) {
      // Legacy format: inline base64
      base64Data = draft.base64Data
    } else {
      return null
    }

    const byteCharacters = atob(base64Data!)
    const byteArray = new Uint8Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i)
    }
    const blob = new Blob([byteArray], { type: draft.mediaType })
    const url = URL.createObjectURL(blob)

    // Track blob URL for cleanup
    const existing = draftBlobUrls.get(draft.id) || []
    draftBlobUrls.set(draft.id, [...existing, url])

    return {
      id: draft.id,
      filename: draft.filename,
      url,
      base64Data,
      tempPath,
      mediaType: draft.mediaType,
      isLoading: false,
    }
  } catch (err) {
    draftsLog.error("Failed to restore image:", err)
    return null
  }
}

/**
 * Restore UploadedFile from DraftFile.
 * Supports both new format (tempPath → read from disk) and legacy format (inline base64).
 * Tracks blob URL for cleanup to prevent memory leaks.
 */
export async function fromDraftFile(draft: DraftFile): Promise<UploadedFile | null> {
  try {
    let base64Data: string | undefined
    let tempPath: string | undefined

    if (draft.tempPath) {
      // New format: read from disk
      const result = await trpcClient.files.readDraftAttachment.query({
        tempPath: draft.tempPath,
      })
      if (!result) return null
      base64Data = result.base64Data
      tempPath = draft.tempPath
    } else if (draft.base64Data) {
      // Legacy format: inline base64
      base64Data = draft.base64Data
    } else {
      return null
    }

    const byteCharacters = atob(base64Data!)
    const byteArray = new Uint8Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i)
    }
    const blob = new Blob([byteArray], {
      type: draft.type || "application/octet-stream",
    })
    const url = URL.createObjectURL(blob)

    // Track blob URL for cleanup
    const existing = draftBlobUrls.get(draft.id) || []
    draftBlobUrls.set(draft.id, [...existing, url])

    return {
      id: draft.id,
      filename: draft.filename,
      url,
      tempPath,
      size: draft.size,
      type: draft.type,
      isLoading: false,
    }
  } catch (err) {
    draftsLog.error("Failed to restore file:", err)
    return null
  }
}

/**
 * Restore SelectedTextContext from DraftTextContext
 */
export function fromDraftTextContext(
  draft: DraftTextContext
): SelectedTextContext {
  return {
    id: draft.id,
    text: draft.text,
    sourceMessageId: draft.sourceMessageId,
    preview: draft.preview,
    createdAt: new Date(draft.createdAt),
  }
}

/**
 * Restore DiffTextContext from DraftDiffTextContext
 */
export function fromDraftDiffTextContext(
  draft: DraftDiffTextContext
): DiffTextContext {
  return {
    id: draft.id,
    text: draft.text,
    filePath: draft.filePath,
    lineNumber: draft.lineNumber,
    lineType: draft.lineType,
    preview: draft.preview,
    createdAt: new Date(draft.createdAt),
    comment: draft.comment,
  }
}

/**
 * Full draft data including attachments
 */
export interface FullDraftData {
  text: string | null
  images: UploadedImage[]
  files: UploadedFile[]
  textContexts: SelectedTextContext[]
  diffTextContexts: DiffTextContext[]
}

/**
 * Get full sub-chat draft including attachments and text contexts.
 * Now async because restoring attachments may require reading from disk.
 */
export async function getSubChatDraftFull(
  chatId: string,
  subChatId: string
): Promise<FullDraftData | null> {
  const globalDrafts = loadGlobalDrafts()
  const key = getSubChatDraftKey(chatId, subChatId)
  const draft = globalDrafts[key] as DraftContent | undefined

  if (!draft) return null

  // Restore attachments in parallel (async: may read from disk)
  const [images, files] = await Promise.all([
    Promise.all(
      (draft.images ?? []).map(fromDraftImage)
    ).then((results) => results.filter((img): img is UploadedImage => img !== null)),
    Promise.all(
      (draft.files ?? []).map(fromDraftFile)
    ).then((results) => results.filter((f): f is UploadedFile => f !== null)),
  ])

  return {
    text: draft.text || null,
    images,
    files,
    textContexts: draft.textContexts?.map(fromDraftTextContext) ?? [],
    diffTextContexts: draft.diffTextContexts?.map(fromDraftDiffTextContext) ?? [],
  }
}

/**
 * Save sub-chat draft with attachments (synchronous — only stores tempPath references).
 * Falls back to inline base64 for images that haven't been persisted to disk yet.
 */
export function saveSubChatDraftWithAttachments(
  chatId: string,
  subChatId: string,
  text: string,
  options?: {
    images?: UploadedImage[]
    files?: UploadedFile[]
    textContexts?: SelectedTextContext[]
    diffTextContexts?: DiffTextContext[]
  }
): { success: boolean; error?: string } {
  const globalDrafts = loadGlobalDrafts()
  const key = getSubChatDraftKey(chatId, subChatId)

  const hasContent =
    text.trim() ||
    (options?.images?.length ?? 0) > 0 ||
    (options?.files?.length ?? 0) > 0 ||
    (options?.textContexts?.length ?? 0) > 0 ||
    (options?.diffTextContexts?.length ?? 0) > 0

  if (!hasContent) {
    delete globalDrafts[key]
    saveGlobalDrafts(globalDrafts)
    return { success: true }
  }

  // Convert attachments to persistable format (synchronous — uses tempPath or base64)
  const draftImages =
    options?.images
      ?.map(toDraftImage)
      .filter((img): img is DraftImage => img !== null) ?? []

  const draftFiles =
    options?.files
      ?.map(toDraftFile)
      .filter((f): f is DraftFile => f !== null) ?? []

  const draftTextContexts = options?.textContexts?.map(toDraftTextContext) ?? []
  const draftDiffTextContexts = options?.diffTextContexts?.map(toDraftDiffTextContext) ?? []

  const draft: DraftContent = {
    text,
    updatedAt: Date.now(),
    ...(draftImages.length > 0 && { images: draftImages }),
    ...(draftFiles.length > 0 && { files: draftFiles }),
    ...(draftTextContexts.length > 0 && { textContexts: draftTextContexts }),
    ...(draftDiffTextContexts.length > 0 && { diffTextContexts: draftDiffTextContexts }),
  }

  // Storage limit check — only relevant when using inline base64 fallback
  if (wouldExceedStorageLimit(draft)) {
    draftsLog.warn(
      "[drafts] Storage limit would be exceeded, skipping attachment persistence"
    )
    // Save without attachments as fallback
    globalDrafts[key] = { text, updatedAt: Date.now() }
    try {
      saveGlobalDrafts(globalDrafts)
      return { success: true, error: "attachments_skipped" }
    } catch {
      return { success: false, error: "storage_full" }
    }
  }

  globalDrafts[key] = draft

  try {
    saveGlobalDrafts(globalDrafts)
    return { success: true }
  } catch (err) {
    draftsLog.error("Failed to save draft:", err)
    return { success: false, error: "save_failed" }
  }
}

