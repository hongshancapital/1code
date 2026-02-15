/**
 * useBrowserScreenshot - Listen for browser screenshots and add to chat input
 *
 * Watches for pending browser screenshots (base64 data URLs),
 * converts them to File objects, and adds them as attachments.
 */

import { useEffect, useMemo } from "react"
import { useAtom } from "jotai"
import { browserPendingScreenshotAtomFamily } from "../../browser-sidebar/atoms"

export interface UseBrowserScreenshotOptions {
  parentChatId: string
  handleAddAttachments: (files: File[]) => Promise<void>
}

export function useBrowserScreenshot({
  parentChatId,
  handleAddAttachments,
}: UseBrowserScreenshotOptions): void {
  const browserPendingScreenshotAtom = useMemo(
    () => browserPendingScreenshotAtomFamily(parentChatId),
    [parentChatId],
  )
  const [pendingScreenshot, setPendingScreenshot] = useAtom(
    browserPendingScreenshotAtom,
  )

  useEffect(() => {
    if (!pendingScreenshot) return

    const addScreenshotToInput = async () => {
      try {
        const [header, base64Data] = pendingScreenshot.split(",")
        if (!base64Data) return

        const mimeMatch = header?.match(/data:([^;]+)/)
        const mimeType = mimeMatch?.[1] || "image/png"
        const extension = mimeType.split("/")[1] || "png"

        const byteCharacters = atob(base64Data)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: mimeType })

        const filename = `browser-screenshot-${Date.now()}.${extension}`
        const file = new File([blob], filename, { type: mimeType })

        await handleAddAttachments([file])
      } catch (error) {
        console.error("Failed to add screenshot to input:", error)
      } finally {
        setPendingScreenshot(null)
      }
    }

    addScreenshotToInput()
  }, [pendingScreenshot, setPendingScreenshot, handleAddAttachments])
}
