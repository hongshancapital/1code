/**
 * Image Generation MCP Server
 *
 * Provides text-to-image (generate_image) and image-to-image (edit_image) tools
 * via OpenAI-compatible API endpoints (/v1/images/generations, /v1/images/edits).
 *
 * Uses @anthropic-ai/claude-agent-sdk's createSdkMcpServer for seamless integration.
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

// Context type for image gen server
export interface ImageGenMcpContext {
  /** Working directory for saving generated images */
  cwd: string
  /** SubChat ID for artifact tracking */
  subChatId: string
  /** Image API configuration */
  apiConfig: {
    baseUrl: string // e.g. "https://api.openai.com/v1" or custom endpoint
    apiKey: string
    model: string // e.g. "dall-e-3", "gpt-image-1", etc.
  }
}

/**
 * Ensure output directory exists
 */
function ensureOutputDir(cwd: string): string {
  const outputDir = path.join(cwd, "generated-images")
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  return outputDir
}

/**
 * Generate a timestamped filename
 */
function generateFilename(prefix: string, ext: string = "png"): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  return `${prefix}-${ts}.${ext}`
}

/**
 * Normalize base URL: strip trailing slashes, ensure ends with /v1 if needed
 */
function normalizeBaseUrl(url: string): string {
  const stripped = url.replace(/\/+$/, "")
  if (/\/v\d+$/.test(stripped)) return stripped
  return `${stripped}/v1`
}

/**
 * Create Image Generation MCP server with tools
 */
export async function createImageGenMcpServer(context: ImageGenMcpContext) {
  const { createSdkMcpServer, tool } = await getSdkModule()
  const { apiConfig } = context

  const baseUrl = normalizeBaseUrl(apiConfig.baseUrl)

  return createSdkMcpServer({
    name: "image-gen",
    version: "1.0.0",
    tools: [
      // ========================================
      // generate_image - 文生图
      // ========================================
      tool(
        "generate_image",
        `Generate an image from a text description using an AI image generation model.

【When to Use】
- When the user asks to create, draw, or generate an image
- When the user describes something they want to visualize
- When creating illustrations, diagrams, or visual content

【Parameters】
- prompt: Detailed description of the image to generate (English recommended for best results)
- size: Image size (default: 1024x1024)
- quality: Image quality - "standard" or "hd" (default: standard)
- n: Number of images to generate (default: 1, max: 4)

【Example】
generate_image(prompt="A serene mountain landscape at sunset with a lake reflection", size="1024x1024")`,
        {
          prompt: z.string().describe("Detailed description of the image to generate"),
          size: z
            .enum(["1024x1024", "1024x1536", "1536x1024", "auto"])
            .default("1024x1024")
            .describe("Image dimensions"),
          quality: z
            .enum(["standard", "hd", "low", "medium", "high", "auto"])
            .default("auto")
            .describe("Image quality level"),
          n: z
            .number()
            .int()
            .min(1)
            .max(4)
            .default(1)
            .describe("Number of images to generate"),
        },
        async (args): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> }> => {
          const { prompt, size, quality, n } = args

          try {
            const response = await fetch(`${baseUrl}/images/generations`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiConfig.apiKey}`,
              },
              body: JSON.stringify({
                model: apiConfig.model,
                prompt,
                size,
                quality,
                n,
                response_format: "b64_json",
              }),
              signal: AbortSignal.timeout(120000), // 2 min timeout for image gen
            })

            if (!response.ok) {
              const errorText = await response.text().catch(() => "Unknown error")
              return {
                content: [
                  {
                    type: "text",
                    text: `Image generation failed: ${response.status} ${response.statusText}\n${errorText}`,
                  },
                ],
              }
            }

            const data = await response.json()
            const images: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> =
              data.data || []

            if (images.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: "No images were generated. The API returned empty results.",
                  },
                ],
              }
            }

            const outputDir = ensureOutputDir(context.cwd)
            const results: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = []

            for (let i = 0; i < images.length; i++) {
              const img = images[i]
              const filename = generateFilename(`gen-${i + 1}`)
              const filePath = path.join(outputDir, filename)

              if (img.b64_json) {
                // Save base64 to file
                const buffer = Buffer.from(img.b64_json, "base64")
                fs.writeFileSync(filePath, buffer)

                // Return image content for inline display
                results.push({
                  type: "image",
                  data: img.b64_json,
                  mimeType: "image/png",
                })

                results.push({
                  type: "text",
                  text: `Image ${i + 1} saved to: ${filePath}\nTo display this image in your response, use markdown: ![${prompt.slice(0, 60)}](${filePath})${img.revised_prompt ? `\nRevised prompt: ${img.revised_prompt}` : ""}`,
                })

                // Notify renderer about the new file (artifact tracking)
                BrowserWindow.getAllWindows().forEach((win) => {
                  win.webContents.send("file-changed", {
                    filePath,
                    type: "tool-ImageGen",
                    subChatId: context.subChatId,
                    description: `Generated image: ${prompt.slice(0, 100)}`,
                  })
                })
              } else if (img.url) {
                results.push({
                  type: "text",
                  text: `Image ${i + 1} URL: ${img.url}${img.revised_prompt ? `\nRevised prompt: ${img.revised_prompt}` : ""}`,
                })
              }
            }

            return { content: results }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Image generation error: ${error instanceof Error ? error.message : "Unknown error"}`,
                },
              ],
            }
          }
        },
      ),

      // ========================================
      // edit_image - 图生图
      // ========================================
      tool(
        "edit_image",
        `Edit or transform an existing image using AI. Supports image-to-image generation.

【When to Use】
- When the user wants to modify, edit, or transform an existing image
- When combining an image with a text description to create a new image
- When applying style transfer or image manipulation

【Parameters】
- prompt: Description of the desired changes or transformation
- image_path: Absolute path to the source image file
- size: Output image size (default: 1024x1024)

【Example】
edit_image(prompt="Add a rainbow in the sky", image_path="/path/to/landscape.png")`,
        {
          prompt: z.string().describe("Description of desired changes or transformation"),
          image_path: z.string().describe("Absolute path to the source image file"),
          size: z
            .enum(["1024x1024", "1024x1536", "1536x1024", "auto"])
            .default("1024x1024")
            .describe("Output image dimensions"),
        },
        async (args): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> }> => {
          const { prompt, image_path, size } = args

          // Validate source image exists
          if (!fs.existsSync(image_path)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Source image not found: ${image_path}`,
                },
              ],
            }
          }

          try {
            // Read image file and convert to base64
            const imageBuffer = fs.readFileSync(image_path)
            const imageBase64 = imageBuffer.toString("base64")

            // Detect mime type from extension
            const ext = path.extname(image_path).toLowerCase()
            const mimeMap: Record<string, string> = {
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".gif": "image/gif",
              ".webp": "image/webp",
            }
            const mimeType = mimeMap[ext] || "image/png"

            // Try the OpenAI images/edits endpoint with multipart form data
            const formData = new FormData()
            const blob = new Blob([imageBuffer], { type: mimeType })
            formData.append("image", blob, path.basename(image_path))
            formData.append("prompt", prompt)
            formData.append("model", apiConfig.model)
            formData.append("size", size)
            formData.append("response_format", "b64_json")

            let response = await fetch(`${baseUrl}/images/edits`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiConfig.apiKey}`,
              },
              body: formData,
              signal: AbortSignal.timeout(120000),
            })

            // If /images/edits fails (not all providers support it), fall back to /images/generations with image reference
            if (!response.ok && response.status === 404) {
              // Fallback: use generations endpoint with the image encoded in prompt
              response = await fetch(`${baseUrl}/images/generations`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiConfig.apiKey}`,
                },
                body: JSON.stringify({
                  model: apiConfig.model,
                  prompt: `Based on the provided reference image, ${prompt}`,
                  size,
                  n: 1,
                  response_format: "b64_json",
                  // Some providers accept image as input in generations
                  image: `data:${mimeType};base64,${imageBase64}`,
                }),
                signal: AbortSignal.timeout(120000),
              })
            }

            if (!response.ok) {
              const errorText = await response.text().catch(() => "Unknown error")
              return {
                content: [
                  {
                    type: "text",
                    text: `Image edit failed: ${response.status} ${response.statusText}\n${errorText}`,
                  },
                ],
              }
            }

            const data = await response.json()
            const images: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> =
              data.data || []

            if (images.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: "No images were generated. The API returned empty results.",
                  },
                ],
              }
            }

            const outputDir = ensureOutputDir(context.cwd)
            const results: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = []

            for (let i = 0; i < images.length; i++) {
              const img = images[i]
              const filename = generateFilename(`edit-${i + 1}`)
              const filePath = path.join(outputDir, filename)

              if (img.b64_json) {
                const buffer = Buffer.from(img.b64_json, "base64")
                fs.writeFileSync(filePath, buffer)

                results.push({
                  type: "image",
                  data: img.b64_json,
                  mimeType: "image/png",
                })

                results.push({
                  type: "text",
                  text: `Edited image saved to: ${filePath}\nTo display this image in your response, use markdown: ![${prompt.slice(0, 60)}](${filePath})${img.revised_prompt ? `\nRevised prompt: ${img.revised_prompt}` : ""}`,
                })

                // Notify renderer
                BrowserWindow.getAllWindows().forEach((win) => {
                  win.webContents.send("file-changed", {
                    filePath,
                    type: "tool-ImageEdit",
                    subChatId: context.subChatId,
                    description: `Edited image: ${prompt.slice(0, 100)}`,
                  })
                })
              } else if (img.url) {
                results.push({
                  type: "text",
                  text: `Edited image URL: ${img.url}`,
                })
              }
            }

            return { content: results }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Image edit error: ${error instanceof Error ? error.message : "Unknown error"}`,
                },
              ],
            }
          }
        },
      ),
    ],
  })
}
