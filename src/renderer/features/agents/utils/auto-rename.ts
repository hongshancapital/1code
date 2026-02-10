// Helper to sleep for a given duration
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface AutoRenameParams {
  subChatId: string
  parentChatId: string
  userMessage: string
  isFirstSubChat: boolean
  generateName: (userMessage: string) => Promise<{ name: string }>
  renameSubChat: (input: { subChatId: string; name: string }) => Promise<void>
  renameChat: (input: { chatId: string; name: string }) => Promise<void>
  updateSubChatName: (subChatId: string, name: string) => void
  updateChatName: (chatId: string, name: string) => void
}

/**
 * Auto-rename a sub-chat (and optionally parent chat) based on the user's first message.
 * Generates a name via LLM, then retries renaming until the chat exists in DB.
 * Fire-and-forget - doesn't block chat streaming.
 */
export async function autoRenameAgentChat({
  subChatId,
  parentChatId,
  userMessage,
  isFirstSubChat,
  generateName,
  renameSubChat,
  renameChat,
  updateSubChatName,
  updateChatName,
}: AutoRenameParams) {
  console.log("[auto-rename] Called with:", { subChatId, parentChatId, userMessage: userMessage.slice(0, 50), isFirstSubChat })

  try {
    // 1. Generate name from LLM via tRPC
    console.log("[auto-rename] Calling generateName...")
    const { name } = await generateName(userMessage)
    console.log("[auto-rename] Generated name:", name)

    if (!name || name === "New Chat") {
      console.log("[auto-rename] Skipping - generic name")
      return // Don't rename if we got a generic name
    }

    // 2. Retry loop with delays [0, 3000, 5000, 5000]ms
    const delays = [0, 3_000, 5_000, 5_000]

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (attempt > 0) {
        await sleep(delays[attempt])
      }

      try {
        // Rename sub-chat
        console.log(`[auto-rename] Attempt ${attempt + 1}: renaming subChat ${subChatId} to "${name}"`)
        await renameSubChat({ subChatId, name })
        console.log(`[auto-rename] renameSubChat succeeded`)
        updateSubChatName(subChatId, name)
        console.log(`[auto-rename] updateSubChatName succeeded`)

        // Also rename parent chat if this is the first sub-chat
        if (isFirstSubChat) {
          console.log(`[auto-rename] Renaming parent chat ${parentChatId}`)
          await renameChat({ chatId: parentChatId, name })
          updateChatName(parentChatId, name)
          console.log(`[auto-rename] Parent chat renamed`)
        }

        console.log(`[auto-rename] ✓ Rename complete!`)
        return // Success!
      } catch (err) {
        // NOT_FOUND or other error - retry
        console.warn(`[auto-rename] Attempt ${attempt + 1} failed:`, (err as Error).message || err)
        if (attempt === delays.length - 1) {
          console.error(
            `[auto-rename] Failed to rename after ${delays.length} attempts`,
          )
        }
      }
    }
  } catch (error) {
    console.error("[auto-rename] Auto-rename failed:", error)
  }
}
