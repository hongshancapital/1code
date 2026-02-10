import { publicProcedure, router } from "../index"
import { getBrowserToolDefinitions } from "../../browser/mcp-server"
import { getImageProcessToolDefinitions } from "../../mcp/image-process-server"
import { getImageGenToolDefinitions } from "../../mcp/image-gen-server"
import { getArtifactToolDefinitions } from "../../mcp/artifact-server"
import { z } from "zod"

// Helper to format tool definitions
function formatTools(tools: any[]) {
  return tools.map((t: any) => {
    // Handle both camelCase and snake_case for input schema
    const schema = t.inputSchema || t.input_schema || {}
    return {
      name: t.name,
      description: t.description || "",
      inputSchema: schema
    }
  })
}

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
    console.log("[InternalTools] list called - START")
    const results = {
      browser: [] as any[],
      imageProcess: [] as any[],
      imageGen: [] as any[],
      artifact: [] as any[]
    }

    const dummyContext = {
      cwd: process.cwd(),
      subChatId: "internal-tool-discovery",
      apiConfig: { baseUrl: "", apiKey: "", model: "" }
    }

    // 1. Browser Tools
    try {
      console.log("[InternalTools] Loading browser tools...")
      const browserTools = await withTimeout(getBrowserToolDefinitions(), 2000, "browser tools")
      console.log(`[InternalTools] Browser tools loaded: ${browserTools.length}`)
      results.browser = formatTools(browserTools)
    } catch (e) {
      console.error("[InternalTools] Failed to load browser tools:", e)
      // @ts-ignore
      results.browserError = e instanceof Error ? e.message : String(e)
    }

    // 2. Image Process Tools
    try {
      console.log("[InternalTools] Loading image process tools...")
      const imageProcessTools = await withTimeout(getImageProcessToolDefinitions(dummyContext), 2000, "image process tools")
      console.log(`[InternalTools] Image process tools loaded: ${imageProcessTools.length}`)
      results.imageProcess = formatTools(imageProcessTools)
    } catch (e) {
      console.error("[InternalTools] Failed to load image process tools:", e)
      // @ts-ignore
      results.imageProcessError = e instanceof Error ? e.message : String(e)
    }

    // 3. Image Gen Tools
    try {
      console.log("[InternalTools] Loading image gen tools...")
      const imageGenTools = await withTimeout(getImageGenToolDefinitions(dummyContext), 2000, "image gen tools")
      console.log(`[InternalTools] Image gen tools loaded: ${imageGenTools.length}`)
      results.imageGen = formatTools(imageGenTools)
    } catch (e) {
      console.error("[InternalTools] Failed to load image gen tools:", e)
      // @ts-ignore
      results.imageGenError = e instanceof Error ? e.message : String(e)
    }

    // 4. Artifact Tools
    try {
      console.log("[InternalTools] Loading artifact tools...")
      const artifactTools = await withTimeout(getArtifactToolDefinitions(dummyContext), 2000, "artifact tools")
      console.log(`[InternalTools] Artifact tools loaded: ${artifactTools.length}`)
      results.artifact = formatTools(artifactTools)
    } catch (e) {
      console.error("[InternalTools] Failed to load artifact tools:", e)
      // @ts-ignore
      results.artifactError = e instanceof Error ? e.message : String(e)
    }

    console.log("[InternalTools] list called - END")
    return results
  })
})
