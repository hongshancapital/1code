/**
 * Artifact MCP Server - Custom MCP server for marking artifacts
 *
 * Uses @anthropic-ai/claude-agent-sdk's createSdkMcpServer for seamless integration
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { BrowserWindow } from "electron"

// Dynamic import for ESM module
let sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null

async function getSdkModule() {
  if (!sdkModule) {
    sdkModule = await import("@anthropic-ai/claude-agent-sdk")
  }
  return sdkModule
}

// Context type for artifact server
interface ArtifactMcpContext {
  subChatId: string
  artifactsFilePath: string
  // Function to extract contexts from current message parts
  getContexts: () => Array<{
    type: "file" | "url"
    filePath?: string
    url?: string
    toolType?: string
    title?: string
  }>
}

// Artifact type for storage
interface StoredArtifact {
  path: string
  description?: string
  status: "created" | "modified" | "deleted"
  timestamp: number
}

/**
 * Read current artifacts from file
 */
function readArtifacts(filePath: string): StoredArtifact[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return []
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    return JSON.parse(content) || []
  } catch {
    return []
  }
}

/**
 * Write artifacts to file
 */
function writeArtifacts(filePath: string, artifacts: StoredArtifact[]): void {
  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(artifacts, null, 2), "utf-8")
  } catch (e) {
    console.error("[ArtifactMcp] Failed to write artifacts:", e)
  }
}

/**
 * Create Artifact MCP server with tools
 */
export async function getArtifactToolDefinitions(context: ArtifactMcpContext) {
  const { tool } = await getSdkModule()

  return [
      // ========================================
      // mark_artifact - 标记交付物
      // ========================================
      tool(
        "mark_artifact",
        `Mark a file as a deliverable artifact. Use this after generating files via scripts (e.g., Python generating PDF, Node.js creating images) to add them to the artifacts panel.

【When to Use】
- After running a script that creates output files (PDF, images, documents)
- After using Bash to generate files that aren't tracked by Write/Edit tools
- When you want to highlight important output files for the user

【Parameters】
- file_path: Absolute path to the file (must exist on disk)
- description: Optional description for the artifact

【Example】
After running: python generate_report.py
Call: mark_artifact(file_path="/path/to/report.pdf", description="Monthly Report")`,
        {
          file_path: z.string().describe("Absolute path to the file to mark as artifact"),
          description: z.string().optional().describe("Optional description of the artifact"),
        },
        async (args): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
          const { file_path, description } = args

          // Validate file exists
          if (!fs.existsSync(file_path)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: File not found: ${file_path}`,
                },
              ],
            }
          }

          // Check if already marked
          const currentArtifacts = readArtifacts(context.artifactsFilePath)
          const alreadyMarked = currentArtifacts.find((a) => a.path === file_path)
          if (alreadyMarked) {
            return {
              content: [
                {
                  type: "text",
                  text: `File already marked as artifact: ${file_path}`,
                },
              ],
            }
          }

          // Add new artifact
          const newArtifact: StoredArtifact = {
            path: file_path,
            description,
            status: "created",
            timestamp: Date.now(),
          }
          currentArtifacts.push(newArtifact)
          writeArtifacts(context.artifactsFilePath, currentArtifacts)

          // Get contexts from current message
          const contexts = context.getContexts()

          // Send IPC event to renderer
          BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send("file-changed", {
              filePath: file_path,
              type: "tool-MarkArtifact",
              subChatId: context.subChatId,
              contexts,
              description,
            })
          })

          console.log(`[ArtifactMcp] Marked artifact: ${file_path} contexts=${contexts.length}`)

          return {
            content: [
              {
                type: "text",
                text: `Artifact marked: ${file_path}${description ? ` (${description})` : ""}`,
              },
            ],
          }
        }
      ),

      // ========================================
      // list_artifacts - 列出已标记的交付物
      // ========================================
      tool(
        "list_artifacts",
        `List all currently marked artifacts for this session.

【When to Use】
- Before marking new artifacts, to check what's already marked
- To review deliverables before completing a task
- To avoid duplicate artifact entries`,
        {},
        async (): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
          const artifacts = readArtifacts(context.artifactsFilePath)

          if (artifacts.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No artifacts have been marked yet in this session.",
                },
              ],
            }
          }

          const list = artifacts
            .map((a) => {
              const desc = a.description ? ` - ${a.description}` : ""
              const status = a.status === "created" ? "🆕" : a.status === "modified" ? "📝" : "🗑️"
              return `${status} ${a.path}${desc}`
            })
            .join("\n")

          return {
            content: [
              {
                type: "text",
                text: `Currently marked artifacts (${artifacts.length}):\n${list}`,
              },
            ],
          }
        }
      ),
    ]
}

export async function createArtifactMcpServer(context: ArtifactMcpContext) {
  const { createSdkMcpServer } = await getSdkModule()
  const tools = await getArtifactToolDefinitions(context)

  return createSdkMcpServer({
    name: "artifact-marker",
    version: "1.0.0",
    tools,
  })
}
