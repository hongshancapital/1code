/**
 * tRPC client for remote web backend
 * Uses signedFetch via IPC for authentication (no CORS issues)
 *
 * [CLOUD DISABLED] This module is currently disabled as the web backend is not available.
 * The AppRouter type is stubbed to allow compilation.
 */
import { createTRPCClient, httpLink } from "@trpc/client"
// [CLOUD DISABLED] Stub type for disabled cloud features
// import type { AppRouter } from "../../../../web/server/api/root"
import SuperJSON from "superjson"

// Placeholder URL - actual base is fetched dynamically from main process
const TRPC_PLACEHOLDER = "/__dynamic__/api/trpc"

// Cache the API base URL after first fetch
let cachedApiBase: string | null = null

async function getApiBase(): Promise<string> {
  if (!cachedApiBase) {
    if (!window.desktopApi?.getApiBaseUrl) {
      throw new Error("Desktop API not available")
    }
    cachedApiBase = await window.desktopApi.getApiBaseUrl()
  }
  return cachedApiBase
}

/**
 * Custom fetch that goes through Electron IPC
 * Automatically adds auth token and bypasses CORS
 * Replaces placeholder URL with actual API base from env
 */
const signedFetch: typeof fetch = async (input, init) => {
  if (typeof window === "undefined" || !window.desktopApi?.signedFetch) {
    throw new Error("Desktop API not available")
  }

  let url = typeof input === "string" ? input : input.toString()

  // Replace placeholder with actual API base
  if (url.startsWith("/__dynamic__")) {
    const apiBase = await getApiBase()
    url = url.replace("/__dynamic__", apiBase)
  }

  const result = await window.desktopApi.signedFetch(url, {
    method: init?.method,
    body: init?.body as string | undefined,
    headers: init?.headers as Record<string, string> | undefined,
  })

  // Convert IPC result to Response-like object
  return {
    ok: result.ok,
    status: result.status,
    json: async () => result.data,
    text: async () => JSON.stringify(result.data),
  } as Response
}

/**
 * tRPC client connected to web backend
 * [CLOUD DISABLED] Stubbed since web backend is not available
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const remoteTrpc: any = createTRPCClient<any>({
  links: [
    httpLink({
      url: TRPC_PLACEHOLDER,
      fetch: signedFetch,
      transformer: SuperJSON,
    }),
  ],
})
