// Helper to sleep for a given duration
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface AutoRenameParams {
  subChatId: string
  parentChatId: string
  userMessage: string
  isFirstSubChat: boolean
  /** Get fallback name immediately, backend will async generate AI name */
  generateName: (userMessage: string) => Promise<{ name: string }>
  renameSubChat: (input: { subChatId: string; name: string }) => Promise<void>
  renameChat: (input: { chatId: string; name: string }) => Promise<void>
  updateSubChatName: (subChatId: string, name: string) => void
  updateChatName: (chatId: string, name: string) => void
  /** Called when name becomes unconfirmed (start shimmer) */
  onNameUnconfirmed?: () => void
  /** Called when name is confirmed (stop shimmer) - fallback if IPC never arrives */
  onNameConfirmed?: () => void
}

/**
 * Auto-rename a sub-chat (and optionally parent chat) based on the user's first message.
 *
 * Flow:
 * 1. Mark name as unconfirmed (start shimmer)
 * 2. Call generateName → immediately returns fallback (truncated message)
 * 3. Set fallback name via renameSubChat (with retry for DB timing)
 * 4. Backend async generates AI name and sends IPC event when done
 * 5. IPC handler confirms the name (stops shimmer)
 *
 * Name confirmation happens via:
 * - AI success: IPC event with AI-generated name
 * - AI failure: IPC event with fallback name (backend confirms it)
 * - User rename: Separate handler confirms name
 * - Timeout fallback: If nothing happens in 15s, confirm anyway
 *
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
  onNameUnconfirmed,
  onNameConfirmed,
}: AutoRenameParams) {
  auto-renameLog.info("Called with:", { subChatId, parentChatId, userMessage: userMessage.slice(0, 50), isFirstSubChat })

  // Mark name as unconfirmed immediately (start shimmer)
  onNameUnconfirmed?.()

  try {
    // 1. Get fallback name immediately (backend kicks off async AI generation)
    auto-renameLog.info("Calling generateName (returns fallback, AI runs in background)...")
    const { name } = await generateName(userMessage)
    auto-renameLog.info("Got fallback name:", name)

    if (!name || name === "New Chat") {
      auto-renameLog.info("Skipping - generic name, confirming immediately")
      onNameConfirmed?.()
      return
    }

    // 2. Retry loop to set fallback name (DB might not have the record yet)
    const delays = [0, 3_000, 5_000, 5_000]

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (attempt > 0) {
        await sleep(delays[attempt])
      }

      try {
        auto-renameLog.info(`Attempt ${attempt + 1}: setting fallback name "${name}"`)
        await renameSubChat({ subChatId, name })
        updateSubChatName(subChatId, name)

        if (isFirstSubChat) {
          await renameChat({ chatId: parentChatId, name })
          updateChatName(parentChatId, name)
        }

        auto-renameLog.info(`✓ Fallback name set!`)
        break
      } catch (err) {
        auto-renameLog.warn(`Attempt ${attempt + 1} failed:`, (err as Error).message || err)
        if (attempt === delays.length - 1) {
          auto-renameLog.error(`Failed to set fallback name after ${delays.length} attempts`)
        }
      }
    }

    // 3. Wait for IPC event to confirm name (AI success or failure)
    // Shimmer will be stopped by the IPC handler, not here
    auto-renameLog.info("Fallback name set, waiting for name confirmation via IPC...")

    // Fallback: if IPC never arrives in 15s, confirm the name anyway
    // This handles edge cases where backend doesn't send IPC
    setTimeout(() => {
      auto-renameLog.info("Fallback timeout: confirming name after 15s")
      onNameConfirmed?.()
    }, 15_000)

  } catch (error) {
    auto-renameLog.error("Auto-rename failed:", error)
    // Confirm name on error (stop shimmer)
    onNameConfirmed?.()
  }
}
