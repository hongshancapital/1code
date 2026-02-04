import { useEffect, useRef } from "react"
import { useAtom } from "jotai"
import { trpc } from "../../lib/trpc"
import { runSessionsAtom } from "../../lib/atoms/runner"

/**
 * Hook to listen for terminal exit events and update run session state.
 * When the terminal process exits, the run session is automatically cleared.
 */
export function useRunSessionListener(projectPath: string) {
  const [runSessions, setRunSessions] = useAtom(runSessionsAtom)
  const session = runSessions[projectPath]

  // Use ref to track if we've already cleared this session
  const clearedSessionIdRef = useRef<string | null>(null)

  // Subscribe to terminal stream events
  trpc.terminal.stream.useSubscription(session?.paneId ?? "", {
    enabled:
      !!session?.paneId &&
      (session.status === "running" ||
        session.status === "starting" ||
        session.status === "stopping"),
    onData: (event) => {
      if (event.type === "exit") {
        // Avoid duplicate clearing
        if (clearedSessionIdRef.current === session?.id) return
        clearedSessionIdRef.current = session?.id ?? null

        // Process exited, clear the session
        setRunSessions((prev) => ({
          ...prev,
          [projectPath]: null,
        }))

        console.log(
          `[Runner] Process exited with code ${event.exitCode}${
            event.signal ? ` (signal: ${event.signal})` : ""
          }`
        )
      }
    },
  })

  // Reset cleared ref when session changes
  useEffect(() => {
    if (!session) {
      clearedSessionIdRef.current = null
    }
  }, [session])

  return session
}
