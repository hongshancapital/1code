import { publicProcedure, router } from "../index"
import { getArtifactToolDefinitions } from "../../mcp/artifact-server"
import { getExtensionManager } from "../../extension"

// Helper to wrap promise with timeout
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout loading ${label} after ${ms}ms`)), ms)
    )
  ])
}

export const internalToolsRouter = router({
  list: publicProcedure.query(async () => {
    const results: Record<string, any[]> = {}

    // 通过 ExtensionManager 统一发现所有 Extension 提供的 Tools
    try {
      const extensionTools = await withTimeout(
        getExtensionManager().listAllTools(),
        5000,
        "extension tools",
      )
      Object.assign(results, extensionTools)
    } catch (e) {
      console.error("[InternalTools] Failed to list extension tools:", e)
    }

    // Artifact MCP（尚未 Extension 化，保留直接导入）
    const dummyContext = {
      subChatId: "internal-tool-discovery",
      artifactsFilePath: "",
      getContexts: () => [],
    }

    try {
      const artifactTools = await withTimeout(getArtifactToolDefinitions(dummyContext), 2000, "artifact tools")
      results.artifact = artifactTools.map((t: any) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema || t.input_schema || {},
      }))
    } catch (e) {
      console.error("[InternalTools] Failed to load artifact tools:", e)
    }

    return results
  })
})
