// File upload hook for desktop app with base64 conversion for Claude API
import { useState, useCallback, useRef, useEffect } from "react"
import { trpcClient } from "../../../lib/trpc"
import { createLogger } from "../../../lib/logger"

const useAgentsFileUploadLog = createLogger("useAgentsFileUpload")


export interface UploadedImage {
  id: string
  filename: string
  url: string // blob URL for preview
  localPath?: string // local file path for backend reference (large image fallback)
  base64Data?: string // base64 encoded data for API
  tempPath?: string // disk temp file path for draft persistence
  isLoading: boolean
  mediaType?: string // MIME type e.g. "image/png", "image/jpeg"
}

export interface UploadedFile {
  id: string
  filename: string
  url: string // blob URL for preview only
  localPath?: string // local file path for backend reference
  tempPath?: string // disk temp file path for draft persistence
  isLoading: boolean
  size?: number
  type?: string
}

/**
 * Convert a File to base64 data
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // Remove the data:image/xxx;base64, prefix
      const base64 = result.split(",")[1]
      resolve(base64 || "")
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Save attachment to disk via tRPC (fire-and-forget, updates state when done).
 * Returns the tempPath on success, undefined on failure.
 */
async function saveToDisk(
  draftKey: string,
  attachmentId: string,
  filename: string,
  base64Data: string,
  mediaType: string
): Promise<string | undefined> {
  try {
    const result = await trpcClient.files.saveDraftAttachment.mutate({
      draftKey,
      attachmentId,
      filename,
      base64Data,
      mediaType,
    })
    return result.tempPath
  } catch (err) {
    useAgentsFileUploadLog.warn("Failed to save attachment to disk:", err)
    return undefined
  }
}

export function useAgentsFileUpload(draftKey?: string) {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isUploading, setIsUploading] = useState(false)

  // Keep draftKey in a ref so the async disk save captures the latest value
  const draftKeyRef = useRef(draftKey)
  useEffect(() => {
    draftKeyRef.current = draftKey
  }, [draftKey])

  const handleAddAttachments = useCallback(async (inputFiles: File[]) => {
    setIsUploading(true)

    const imageFiles = inputFiles.filter((f) => f.type.startsWith("image/"))
    const otherFiles = inputFiles.filter((f) => !f.type.startsWith("image/"))

    // Process images with base64 conversion
    const newImages: UploadedImage[] = await Promise.all(
      imageFiles.map(async (file) => {
        const id = crypto.randomUUID()
        const filename = file.name || `screenshot-${Date.now()}.png`
        const mediaType = file.type || "image/png"
        const url = URL.createObjectURL(file)
        const localPath = (window as any).webUtils?.getPathForFile?.(file) || (file as any).path

        // Convert to base64 for API
        let base64Data: string | undefined
        try {
          base64Data = await fileToBase64(file)
        } catch (err) {
          useAgentsFileUploadLog.error("Failed to convert image to base64:", err)
        }

        return {
          id,
          filename,
          url,
          localPath: localPath || undefined,
          base64Data,
          isLoading: false,
          mediaType,
        }
      })
    )

    const newFiles: UploadedFile[] = await Promise.all(
      otherFiles.map(async (file) => {
        const id = crypto.randomUUID()
        let base64Data: string | undefined
        try {
          base64Data = await fileToBase64(file)
        } catch {
          // non-critical for files
        }

        const localPath = (window as any).webUtils?.getPathForFile?.(file) || (file as any).path
        return {
          id,
          filename: file.name,
          url: URL.createObjectURL(file),
          isLoading: false,
          size: file.size,
          type: file.type,
          localPath: localPath || undefined,
          _base64Data: base64Data, // temporary, used only for disk save below
        } as UploadedFile & { _base64Data?: string }
      })
    )

    setImages((prev) => [...prev, ...newImages])
    setFiles((prev) => [...prev, ...newFiles])
    setIsUploading(false)

    // Asynchronously persist to disk — update tempPath in state when done
    const currentDraftKey = draftKeyRef.current
    if (currentDraftKey) {
      // Save images to disk
      for (const img of newImages) {
        if (!img.base64Data) continue
        saveToDisk(currentDraftKey, img.id, img.filename, img.base64Data, img.mediaType || "image/png")
          .then((tempPath) => {
            if (tempPath) {
              setImages((prev) =>
                prev.map((i) => (i.id === img.id ? { ...i, tempPath } : i))
              )
            }
          })
      }

      // Save files to disk
      for (const file of newFiles) {
        const b64 = (file as UploadedFile & { _base64Data?: string })._base64Data
        if (!b64) continue
        saveToDisk(currentDraftKey, file.id, file.filename, b64, file.type || "application/octet-stream")
          .then((tempPath) => {
            if (tempPath) {
              setFiles((prev) =>
                prev.map((f) => (f.id === file.id ? { ...f, tempPath } : f))
              )
            }
          })
      }
    }
  }, [])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }, [])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const clearImages = useCallback(() => {
    setImages([])
  }, [])

  const clearFiles = useCallback(() => {
    setFiles([])
  }, [])

  const clearAll = useCallback(() => {
    setImages([])
    setFiles([])
  }, [])

  // Direct state setters for restoring from draft
  const setImagesFromDraft = useCallback((draftImages: UploadedImage[]) => {
    setImages(draftImages)
  }, [])

  const setFilesFromDraft = useCallback((draftFiles: UploadedFile[]) => {
    setFiles(draftFiles)
  }, [])

  return {
    images,
    files,
    handleAddAttachments,
    removeImage,
    removeFile,
    clearImages,
    clearFiles,
    clearAll,
    isUploading,
    setImagesFromDraft,
    setFilesFromDraft,
  }
}
