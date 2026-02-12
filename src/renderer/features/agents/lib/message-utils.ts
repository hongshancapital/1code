/**
 * Shared utilities for building message parts (images, files)
 * Used by active-chat.tsx and queue-processor.tsx
 */

const IMAGE_INLINE_THRESHOLD = 5 * 1024 * 1024 // 5MB

/**
 * Build an image part for a user message.
 * Small images (< 5MB) are inlined as base64; large images use file path reference.
 */
export function buildImagePart(img: {
  base64Data?: string
  url: string
  mediaType?: string
  filename?: string
  localPath?: string
  tempPath?: string
}): { type: "data-image"; data: any } | { type: "text"; text: string } {
  const sizeBytes = img.base64Data
    ? Math.ceil((img.base64Data.length * 3) / 4)
    : 0
  if (img.base64Data && sizeBytes <= IMAGE_INLINE_THRESHOLD) {
    // Small image: inline base64 for Claude API
    return {
      type: "data-image" as const,
      data: {
        url: img.url,
        mediaType: img.mediaType,
        filename: img.filename,
        base64Data: img.base64Data,
        localPath: img.localPath,
        tempPath: img.tempPath,
      },
    }
  } else if (img.localPath || img.tempPath) {
    // Large image: pass file path reference
    const path = img.localPath || img.tempPath
    const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1)
    return {
      type: "text" as const,
      text: `[Image attachment: ${img.filename} (${sizeMB}MB) at path: ${path}]`,
    }
  } else {
    // Fallback: inline whatever we have
    return {
      type: "data-image" as const,
      data: {
        url: img.url,
        mediaType: img.mediaType,
        filename: img.filename,
        base64Data: img.base64Data,
        localPath: img.localPath,
        tempPath: img.tempPath,
      },
    }
  }
}

/** Parsed file info extracted from AI instruction text (for old messages without data-file parts) */
export interface ParsedFileAttachment {
  filename: string
  size?: number
  localPath: string
}

/**
 * Strip the AI-facing file attachment instruction from display text,
 * and optionally extract file metadata from it (fallback for old messages).
 */
export function stripFileAttachmentText(text: string): {
  cleanedText: string
  parsedFiles: ParsedFileAttachment[]
} {
  const parsedFiles: ParsedFileAttachment[] = []

  const cleanedText = text.replace(
    /\n?\n?\[The user has attached the following file\(s\)\. Use the Read tool to access their contents:\n([^\]]*)\]/g,
    (_match, fileList: string) => {
      // Parse each "- filename (size): path" line
      const lineRegex = /^- (.+?)(?:\s+\(([^)]+)\))?: (.+)$/gm
      let lineMatch: RegExpExecArray | null
      while ((lineMatch = lineRegex.exec(fileList)) !== null) {
        const filename = lineMatch[1]
        const sizeStr = lineMatch[2]
        const localPath = lineMatch[3]
        let size: number | undefined
        if (sizeStr) {
          const num = parseFloat(sizeStr)
          if (sizeStr.endsWith("MB")) size = Math.round(num * 1024 * 1024)
          else if (sizeStr.endsWith("KB")) size = Math.round(num * 1024)
          else size = Math.round(num)
        }
        parsedFiles.push({ filename, size, localPath })
      }
      return ""
    },
  )

  return { cleanedText, parsedFiles }
}

/**
 * Build a file part for a user message with path information.
 */
export function buildFilePart(f: {
  url: string
  type?: string
  mediaType?: string
  filename: string
  size?: number
  localPath?: string
  tempPath?: string
}): { type: "data-file"; data: any } {
  return {
    type: "data-file" as const,
    data: {
      url: f.url,
      mediaType: f.type || f.mediaType || "application/octet-stream",
      filename: f.filename,
      size: f.size,
      localPath: f.localPath,
      tempPath: f.tempPath,
    },
  }
}
