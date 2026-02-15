import { useCallback } from "react"
import { trpc } from "../../../lib/trpc"
import { toast } from "sonner"
import { useNavigate } from "../../../lib/router"
import type { RemoteChat } from "../../../lib/remote-api"
import { createLogger } from "../../../lib/logger"

const openLocallyMatchLog = createLogger("OPEN-LOCALLY-MATCH")


interface Project {
  id: string
  name: string
  path: string
  gitOwner: string | null
  gitRepo: string | null
}

export function useAutoImport() {
  const { navigateToChat } = useNavigate()
  const utils = trpc.useUtils()

  const importMutation = trpc.sandboxImport.importSandboxChat.useMutation({
    onSuccess: (result) => {
      toast.success("Opened locally")
      navigateToChat(result.chatId)
      utils.chats.list.invalidate()
    },
    onError: (error) => {
      toast.error(`Import failed: ${error.message}`)
    },
  })

  const getMatchingProjects = useCallback(
    (projects: Project[], remoteChat: RemoteChat): Project[] => {
      openLocallyMatchLog.info(`========== MATCHING DEBUG ==========`)
      openLocallyMatchLog.info(`Remote chat:`, {
        id: remoteChat.id,
        name: remoteChat.name,
        meta: remoteChat.meta,
      })

      if (!remoteChat.meta?.repository) {
        openLocallyMatchLog.info(`No repository in meta, returning []`)
        return []
      }

      const [owner, repo] = remoteChat.meta.repository.split("/")
      openLocallyMatchLog.info(`Looking for: owner="${owner}", repo="${repo}"`)

      openLocallyMatchLog.info(`All projects (${projects.length}):`)
      projects.forEach((p, i) => {
        openLocallyMatchLog.info(`  ${i + 1}. "${p.name}" at ${p.path}`)
        openLocallyMatchLog.info(`     gitOwner="${p.gitOwner}", gitRepo="${p.gitRepo}"`)
        openLocallyMatchLog.info(`     matches: ${p.gitOwner === owner && p.gitRepo === repo}`)
      })

      const matches = projects.filter((p) => p.gitOwner === owner && p.gitRepo === repo)
      openLocallyMatchLog.info(`Found ${matches.length} matching project(s)`)
      openLocallyMatchLog.info(`========== END MATCHING DEBUG ==========`)

      return matches
    },
    []
  )

  const autoImport = useCallback(
    (remoteChat: RemoteChat, project: Project) => {
      if (!remoteChat.sandbox_id) {
        toast.error("This chat has no sandbox to import")
        return
      }
      importMutation.mutate({
        sandboxId: remoteChat.sandbox_id,
        remoteChatId: remoteChat.id,
        projectId: project.id,
        chatName: remoteChat.name,
      })
    },
    [importMutation]
  )

  return {
    getMatchingProjects,
    autoImport,
    isImporting: importMutation.isPending,
  }
}
