/**
 * Queue utilities for managing message queue in agents chat
 * Adapted from canvas chat queue implementation
 */

import type { UploadedImage, UploadedFile } from "../hooks/use-agents-file-upload"

export interface QueuedImage {
  id: string
  url: string
  mediaType: string
  filename?: string
  base64Data?: string
  localPath?: string
}

export interface QueuedFile {
  id: string
  url: string
  filename: string
  mediaType?: string
  size?: number
  localPath?: string
}

// Text context selected from assistant messages
export interface SelectedTextContext {
  id: string
  text: string
  sourceMessageId: string
  preview: string // Truncated for display (~50 chars)
  createdAt: Date
}

export interface QueuedTextContext {
  id: string
  text: string
  sourceMessageId: string
}

// Text context selected from diff sidebar
export interface DiffTextContext {
  id: string
  text: string
  filePath: string
  lineNumber?: number
  lineType?: "old" | "new"
  preview: string // Truncated for display
  createdAt: Date
  /** User's comment/feedback on this code selection */
  comment?: string
}

export interface QueuedDiffTextContext {
  id: string
  text: string
  filePath: string
  lineNumber?: number
  lineType?: "old" | "new"
  /** User's comment/feedback on this code selection */
  comment?: string
}

export type AgentQueueItem = {
  id: string
  message: string // Serialized value with @[id] tokens for mentions
  images?: QueuedImage[]
  files?: QueuedFile[]
  textContexts?: QueuedTextContext[]
  diffTextContexts?: QueuedDiffTextContext[]
  timestamp: Date
  status: "pending" | "processing"
}

export function generateQueueId(): string {
  return `queue_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

export function createQueueItem(
  id: string,
  message: string,
  images?: QueuedImage[],
  files?: QueuedFile[],
  textContexts?: QueuedTextContext[],
  diffTextContexts?: QueuedDiffTextContext[]
): AgentQueueItem {
  return {
    id,
    message,
    images: images && images.length > 0 ? images : undefined,
    files: files && files.length > 0 ? files : undefined,
    textContexts: textContexts && textContexts.length > 0 ? textContexts : undefined,
    diffTextContexts: diffTextContexts && diffTextContexts.length > 0 ? diffTextContexts : undefined,
    timestamp: new Date(),
    status: "pending",
  }
}

export function getNextQueueItem(
  queue: AgentQueueItem[]
): AgentQueueItem | null {
  return queue.find((item) => item.status === "pending") || null
}

export function removeQueueItem(
  queue: AgentQueueItem[],
  itemId: string
): AgentQueueItem[] {
  return queue.filter((item) => item.id !== itemId)
}

export function updateQueueItemStatus(
  queue: AgentQueueItem[],
  itemId: string,
  status: AgentQueueItem["status"]
): AgentQueueItem[] {
  return queue.map((item) =>
    item.id === itemId ? { ...item, status } : item
  )
}

// Helper to convert UploadedImage to QueuedImage
export function toQueuedImage(img: UploadedImage): QueuedImage {
  return {
    id: img.id,
    url: img.url,
    mediaType: img.mediaType || "image/png",
    filename: img.filename,
    base64Data: img.base64Data,
    localPath: img.localPath,
  }
}

// Helper to convert UploadedFile to QueuedFile
export function toQueuedFile(file: UploadedFile): QueuedFile {
  return {
    id: file.id,
    url: file.url,
    filename: file.filename,
    mediaType: file.type,
    size: file.size,
    localPath: file.localPath,
  }
}

// Helper to convert SelectedTextContext to QueuedTextContext
export function toQueuedTextContext(ctx: SelectedTextContext): QueuedTextContext {
  return {
    id: ctx.id,
    text: ctx.text,
    sourceMessageId: ctx.sourceMessageId,
  }
}

// Helper to convert DiffTextContext to QueuedDiffTextContext
export function toQueuedDiffTextContext(ctx: DiffTextContext): QueuedDiffTextContext {
  return {
    id: ctx.id,
    text: ctx.text,
    filePath: ctx.filePath,
    lineNumber: ctx.lineNumber,
    lineType: ctx.lineType,
    comment: ctx.comment,
  }
}

// Helper to create a truncated preview from text
export function createTextPreview(text: string, maxLength: number = 50): string {
  const trimmed = text.trim().replace(/\s+/g, " ")
  if (trimmed.length <= maxLength) return trimmed
  return trimmed.slice(0, maxLength) + "..."
}
