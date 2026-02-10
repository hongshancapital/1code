/**
 * Image Process MCP Server
 *
 * Provides local image processing tools powered by sharp.
 * No external API required — all operations are performed locally.
 *
 * Uses @anthropic-ai/claude-agent-sdk's createSdkMcpServer for seamless integration.
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import sharp from "sharp"
import { BrowserWindow } from "electron"

// Dynamic import for ESM module
let sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null

async function getSdkModule() {
  if (!sdkModule) {
    sdkModule = await import("@anthropic-ai/claude-agent-sdk")
  }
  return sdkModule
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ImageProcessMcpContext {
  /** Working directory for resolving relative paths and saving output files */
  cwd: string
  /** SubChat ID for artifact tracking */
  subChatId: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolResult = { content: Array<{ type: "text"; text: string }> }

function validateSourceImage(imagePath: string): string | null {
  if (!fs.existsSync(imagePath)) {
    return `Error: Source image not found: ${imagePath}`
  }
  return null
}

function resolveOutputPathArg(outputPath: string | undefined, cwd: string): string | undefined {
  if (!outputPath) return undefined
  if (path.isAbsolute(outputPath)) return outputPath
  return path.resolve(cwd, outputPath)
}

function resolveOutputPath(sourcePath: string, operation: string, targetFormat?: string): string {
  const dir = path.dirname(sourcePath)
  const ext = targetFormat ? `.${targetFormat}` : path.extname(sourcePath)
  const baseName = path.basename(sourcePath, path.extname(sourcePath))
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  return path.join(dir, `${baseName}-${operation}-${ts}${ext}`)
}

function notifyFileChanged(
  filePath: string,
  subChatId: string,
  toolName: string,
  description: string,
): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("file-changed", {
      filePath,
      type: `tool-ImageProcess-${toolName}`,
      subChatId,
      description,
    })
  })
}

function successResult(filePath: string, description: string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: `${description}\nSaved to: ${filePath}\nTo display: ![result](${filePath})`,
      },
    ],
  }
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }] }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ---------------------------------------------------------------------------
// SVG helpers for annotate / watermark
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function buildAnnotationSvg(
  width: number,
  height: number,
  annotations: Array<{
    type: "rect" | "arrow" | "text"
    x?: number
    y?: number
    w?: number
    h?: number
    x2?: number
    y2?: number
    text?: string
    color: string
    stroke_width: number
    font_size: number
  }>,
): Buffer {
  const elements: string[] = []

  // Define arrow marker
  elements.push(`<defs>`)
  elements.push(`  <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">`)
  elements.push(`    <polygon points="0 0, 10 3.5, 0 7" fill="context-stroke" />`)
  elements.push(`  </marker>`)
  elements.push(`</defs>`)

  for (const a of annotations) {
    const color = a.color || "#ff0000"
    const sw = a.stroke_width || 3
    const fs = a.font_size || 16

    if (a.type === "rect" && a.x != null && a.y != null && a.w != null && a.h != null) {
      elements.push(
        `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" ` +
          `fill="none" stroke="${color}" stroke-width="${sw}" />`,
      )
    } else if (a.type === "arrow" && a.x != null && a.y != null && a.x2 != null && a.y2 != null) {
      elements.push(
        `<line x1="${a.x}" y1="${a.y}" x2="${a.x2}" y2="${a.y2}" ` +
          `stroke="${color}" stroke-width="${sw}" marker-end="url(#arrowhead)" />`,
      )
    } else if (a.type === "text" && a.x != null && a.y != null && a.text) {
      elements.push(
        `<text x="${a.x}" y="${a.y}" font-size="${fs}" fill="${color}" ` +
          `font-family="Arial, Helvetica, sans-serif">${escapeXml(a.text)}</text>`,
      )
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n${elements.join("\n")}\n</svg>`
  return Buffer.from(svg)
}

function buildWatermarkSvg(
  width: number,
  height: number,
  text: string,
  position: string,
  opacity: number,
  fontSize: number,
  color: string,
): Buffer {
  // Calculate text position based on gravity
  let x: number
  let y: number
  let anchor: string

  const padding = fontSize

  switch (position) {
    case "top-left":
      x = padding
      y = padding + fontSize
      anchor = "start"
      break
    case "top-right":
      x = width - padding
      y = padding + fontSize
      anchor = "end"
      break
    case "bottom-left":
      x = padding
      y = height - padding
      anchor = "start"
      break
    case "bottom-right":
      x = width - padding
      y = height - padding
      anchor = "end"
      break
    case "center":
    default:
      x = width / 2
      y = height / 2
      anchor = "middle"
      break
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${color}" ` +
    `fill-opacity="${opacity}" text-anchor="${anchor}" ` +
    `font-family="Arial, Helvetica, sans-serif">${escapeXml(text)}</text>` +
    `</svg>`

  return Buffer.from(svg)
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function getImageProcessToolDefinitions(context: ImageProcessMcpContext) {
  const { tool } = await getSdkModule()

  /** Resolve relative paths using the working directory */
  function resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath
    return path.resolve(context.cwd, filePath)
  }

  return [
      // ================================================================
      // image_info — 获取图片元信息
      // ================================================================
      tool(
        "image_info",
        `Get detailed metadata of an image file including dimensions, format, color space, file size, etc.

【When to Use】
- When you need to know an image's dimensions, format, or other properties before processing
- When debugging image issues or understanding file characteristics
- Before resize/crop operations to determine current dimensions

【Parameters】
- path: Absolute path to the image file

【Example】
image_info(path="/path/to/photo.jpg")`,
        {
          path: z.string().describe("Absolute path to the image file"),
        },
        async (args): Promise<ToolResult> => {
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            const meta = await sharp(args.path).metadata()
            const stat = fs.statSync(args.path)

            const info = [
              `File: ${args.path}`,
              `Dimensions: ${meta.width}x${meta.height}`,
              `Format: ${meta.format}`,
              `File size: ${formatBytes(stat.size)}`,
              `Channels: ${meta.channels}`,
              `Color space: ${meta.space || "unknown"}`,
              `Has alpha: ${meta.hasAlpha ?? false}`,
              `Density (DPI): ${meta.density || "unknown"}`,
              meta.orientation ? `EXIF orientation: ${meta.orientation}` : null,
            ]
              .filter(Boolean)
              .join("\n")

            return { content: [{ type: "text", text: info }] }
          } catch (error) {
            return errorResult(`Failed to read image info: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_resize — 缩放图片
      // ================================================================
      tool(
        "image_resize",
        `Resize an image to specified dimensions. Supports multiple fit modes.

【When to Use】
- When you need to change image dimensions
- When creating previews or adjusting image size for display

【Parameters】
- path: Absolute path to the source image
- width: Target width in pixels (optional if height is provided)
- height: Target height in pixels (optional if width is provided)
- fit: How to fit - "contain" (fit within), "cover" (crop to fill), "fill" (stretch), "inside" (never upscale), "outside" (never downscale). Default: "inside"
- output_path: Optional output path. If omitted, generates a new file alongside source

【Example】
image_resize(path="/path/to/photo.jpg", width=800)`,
        {
          path: z.string().describe("Absolute path to the source image"),
          width: z.number().int().positive().optional().describe("Target width in pixels"),
          height: z.number().int().positive().optional().describe("Target height in pixels"),
          fit: z
            .enum(["contain", "cover", "fill", "inside", "outside"])
            .default("inside")
            .describe("Resize fit mode"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          if (!args.width && !args.height) {
            return errorResult("Error: At least one of width or height must be provided")
          }
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            const outputPath = resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.path, "resized")
            const info = await sharp(args.path)
              .resize(args.width || null, args.height || null, { fit: args.fit })
              .toFile(outputPath)

            notifyFileChanged(outputPath, context.subChatId, "Resize", `Resized to ${info.width}x${info.height}`)
            return successResult(outputPath, `Image resized to ${info.width}x${info.height} (${info.format}, ${formatBytes(info.size)})`)
          } catch (error) {
            return errorResult(`Image resize error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_crop — 区域裁剪
      // ================================================================
      tool(
        "image_crop",
        `Crop a region from an image.

【When to Use】
- When you need to extract a specific area from an image
- When removing unwanted borders or margins
- When focusing on a particular part of an image

【Parameters】
- path: Absolute path to the source image
- x: X offset from left edge in pixels
- y: Y offset from top edge in pixels
- w: Width of crop region in pixels
- h: Height of crop region in pixels
- output_path: Optional output path

【Example】
image_crop(path="/path/to/photo.jpg", x=100, y=50, w=400, h=300)`,
        {
          path: z.string().describe("Absolute path to the source image"),
          x: z.number().int().min(0).describe("X offset from left edge"),
          y: z.number().int().min(0).describe("Y offset from top edge"),
          w: z.number().int().positive().describe("Width of crop region"),
          h: z.number().int().positive().describe("Height of crop region"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            const meta = await sharp(args.path).metadata()
            if (meta.width && meta.height) {
              if (args.x + args.w > meta.width || args.y + args.h > meta.height) {
                return errorResult(
                  `Error: Crop region (${args.x},${args.y} ${args.w}x${args.h}) exceeds image bounds (${meta.width}x${meta.height})`,
                )
              }
            }

            const outputPath = resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.path, "cropped")
            const info = await sharp(args.path)
              .extract({ left: args.x, top: args.y, width: args.w, height: args.h })
              .toFile(outputPath)

            notifyFileChanged(outputPath, context.subChatId, "Crop", `Cropped ${args.w}x${args.h} from (${args.x},${args.y})`)
            return successResult(outputPath, `Image cropped to ${info.width}x${info.height} (${formatBytes(info.size)})`)
          } catch (error) {
            return errorResult(`Image crop error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_compress — 压缩图片
      // ================================================================
      tool(
        "image_compress",
        `Compress an image to reduce file size. Supports target quality or target file size (KB).

【When to Use】
- When you need to reduce image file size for web or upload
- When optimizing images for faster loading
- When a specific file size limit is required

【Parameters】
- path: Absolute path to the source image
- quality: Compression quality (1-100). Higher = better quality, larger file
- max_kb: Target maximum file size in KB. Uses binary search to find optimal quality. Takes priority over quality
- format: Output format for lossy compression - "jpeg", "webp", "avif". If omitted, preserves original (PNG auto-converts to jpeg if lossy needed)
- output_path: Optional output path

【Example】
image_compress(path="/path/to/photo.png", max_kb=200)
image_compress(path="/path/to/photo.jpg", quality=60)`,
        {
          path: z.string().describe("Absolute path to the source image"),
          quality: z.number().int().min(1).max(100).optional().describe("Compression quality (1-100)"),
          max_kb: z.number().positive().optional().describe("Target maximum file size in KB"),
          format: z
            .enum(["jpeg", "png", "webp", "avif"])
            .optional()
            .describe("Output format. PNG is lossless so quality has no effect on it"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            const meta = await sharp(args.path).metadata()
            // Determine output format
            let fmt = args.format || (meta.format as string) || "jpeg"
            // If format is png and lossy compression requested, switch to jpeg
            if (fmt === "png" && (args.quality || args.max_kb)) {
              fmt = "jpeg"
            }

            const outputPath =
              resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.path, "compressed", fmt)

            if (args.max_kb) {
              // Binary search for target size
              const targetBytes = args.max_kb * 1024
              let lo = 1
              let hi = 100
              let bestBuf: Buffer | null = null
              let bestQ = 80

              for (let i = 0; i < 8; i++) {
                const mid = Math.round((lo + hi) / 2)
                const buf = await sharp(args.path)
                  .toFormat(fmt as keyof sharp.FormatEnum, { quality: mid })
                  .toBuffer()

                if (buf.length <= targetBytes) {
                  bestBuf = buf
                  bestQ = mid
                  lo = mid + 1
                } else {
                  hi = mid - 1
                }
              }

              // If even quality=1 is too large, use it anyway
              if (!bestBuf) {
                bestBuf = await sharp(args.path)
                  .toFormat(fmt as keyof sharp.FormatEnum, { quality: 1 })
                  .toBuffer()
                bestQ = 1
              }

              fs.writeFileSync(outputPath, bestBuf)
              const origSize = fs.statSync(args.path).size
              notifyFileChanged(outputPath, context.subChatId, "Compress", `Compressed to ${formatBytes(bestBuf.length)}`)
              return successResult(
                outputPath,
                `Image compressed: ${formatBytes(origSize)} → ${formatBytes(bestBuf.length)} (quality=${bestQ}, format=${fmt})`,
              )
            } else {
              // Direct quality compression
              const q = args.quality || 80
              const info = await sharp(args.path)
                .toFormat(fmt as keyof sharp.FormatEnum, { quality: q })
                .toFile(outputPath)

              const origSize = fs.statSync(args.path).size
              notifyFileChanged(outputPath, context.subChatId, "Compress", `Compressed with quality=${q}`)
              return successResult(
                outputPath,
                `Image compressed: ${formatBytes(origSize)} → ${formatBytes(info.size)} (quality=${q}, format=${fmt})`,
              )
            }
          } catch (error) {
            return errorResult(`Image compress error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_convert — 格式转换
      // ================================================================
      tool(
        "image_convert",
        `Convert an image to a different format.

【When to Use】
- When converting between formats (e.g., PNG to JPEG, JPEG to WebP)
- When converting to modern formats like WebP or AVIF for web optimization

【Parameters】
- path: Absolute path to the source image
- format: Target format - "jpeg", "png", "webp", "avif", "tiff", "gif"
- quality: Quality for lossy formats (1-100, default 80). Ignored for PNG
- output_path: Optional output path

【Example】
image_convert(path="/path/to/photo.png", format="webp", quality=85)`,
        {
          path: z.string().describe("Absolute path to the source image"),
          format: z.enum(["jpeg", "png", "webp", "avif", "tiff", "gif"]).describe("Target image format"),
          quality: z.number().int().min(1).max(100).default(80).describe("Quality for lossy formats (1-100)"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            const outputPath = resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.path, "converted", args.format)
            const info = await sharp(args.path)
              .toFormat(args.format as keyof sharp.FormatEnum, { quality: args.quality })
              .toFile(outputPath)

            notifyFileChanged(outputPath, context.subChatId, "Convert", `Converted to ${args.format}`)
            return successResult(
              outputPath,
              `Image converted to ${args.format} (${info.width}x${info.height}, ${formatBytes(info.size)})`,
            )
          } catch (error) {
            return errorResult(`Image convert error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_to_base64 — 输出 data URI
      // ================================================================
      tool(
        "image_to_base64",
        `Convert an image to a base64 data URI string, useful for embedding in HTML/CSS/Markdown.

【When to Use】
- When you need to embed an image directly in HTML, CSS, or Markdown
- When creating self-contained documents with inline images

【Parameters】
- path: Absolute path to the image file
- format: Optional output format conversion before encoding (jpeg, png, webp)
- max_width: Optional max width to resize before encoding (reduces base64 size)

【Warning】
Base64 strings can be very large and consume many tokens. Consider using max_width to reduce size.

【Example】
image_to_base64(path="/path/to/icon.png", max_width=64)`,
        {
          path: z.string().describe("Absolute path to the image file"),
          format: z.enum(["jpeg", "png", "webp"]).optional().describe("Optional format conversion"),
          max_width: z.number().int().positive().optional().describe("Max width to resize before encoding"),
        },
        async (args): Promise<ToolResult> => {
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            let pipeline = sharp(args.path)

            if (args.max_width) {
              pipeline = pipeline.resize(args.max_width, null, { fit: "inside" })
            }

            if (args.format) {
              pipeline = pipeline.toFormat(args.format as keyof sharp.FormatEnum)
            }

            const buf = await pipeline.toBuffer()
            const meta = await sharp(buf).metadata()
            const mime = args.format || meta.format || "png"
            const dataUri = `data:image/${mime};base64,${buf.toString("base64")}`

            return {
              content: [
                {
                  type: "text",
                  text: `Base64 data URI (${formatBytes(buf.length)} → ${formatBytes(dataUri.length)} encoded, ${meta.width}x${meta.height}):\n${dataUri}`,
                },
              ],
            }
          } catch (error) {
            return errorResult(`Image to base64 error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_rotate — 旋转/翻转
      // ================================================================
      tool(
        "image_rotate",
        `Rotate and/or flip an image.

【When to Use】
- When fixing image orientation
- When rotating images by specific angles (90, 180, 270 for lossless; any angle supported)
- When mirroring images horizontally or vertically

【Parameters】
- path: Absolute path to the source image
- angle: Rotation angle in degrees (positive = clockwise)
- flip: Flip vertically (mirror over X axis)
- flop: Flip horizontally (mirror over Y axis)
- background: Background color for non-right-angle rotations (default "#ffffff")
- output_path: Optional output path

【Example】
image_rotate(path="/path/to/photo.jpg", angle=90)
image_rotate(path="/path/to/photo.jpg", flop=true)`,
        {
          path: z.string().describe("Absolute path to the source image"),
          angle: z.number().optional().describe("Rotation angle in degrees"),
          flip: z.boolean().default(false).describe("Flip vertically"),
          flop: z.boolean().default(false).describe("Flip horizontally"),
          background: z.string().default("#ffffff").describe("Background color for non-right-angle rotations"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            let pipeline = sharp(args.path)

            if (args.angle != null) {
              pipeline = pipeline.rotate(args.angle, { background: args.background })
            }
            if (args.flip) pipeline = pipeline.flip()
            if (args.flop) pipeline = pipeline.flop()

            const outputPath = resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.path, "rotated")
            const info = await pipeline.toFile(outputPath)

            const ops: string[] = []
            if (args.angle != null) ops.push(`rotated ${args.angle}°`)
            if (args.flip) ops.push("flipped vertically")
            if (args.flop) ops.push("flipped horizontally")
            const desc = ops.join(", ") || "no changes"

            notifyFileChanged(outputPath, context.subChatId, "Rotate", desc)
            return successResult(outputPath, `Image ${desc} (${info.width}x${info.height}, ${formatBytes(info.size)})`)
          } catch (error) {
            return errorResult(`Image rotate error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_concat — 多图拼接
      // ================================================================
      tool(
        "image_concat",
        `Concatenate multiple images into one (horizontal or vertical layout).

【When to Use】
- When combining screenshots side by side or top to bottom
- When creating comparison views or tutorial sequences
- When merging multiple images into a single output

【Parameters】
- paths: Array of absolute paths to images (minimum 2)
- direction: "horizontal" or "vertical" (default "vertical")
- gap: Gap between images in pixels (default 0)
- background: Background/gap color (default "#ffffff")
- output_path: Optional output path

【Example】
image_concat(paths=["/path/to/img1.png", "/path/to/img2.png"], direction="vertical", gap=10)`,
        {
          paths: z.array(z.string()).min(2).describe("Array of absolute paths to images"),
          direction: z.enum(["horizontal", "vertical"]).default("vertical").describe("Layout direction"),
          gap: z.number().int().min(0).default(0).describe("Gap between images in pixels"),
          background: z.string().default("#ffffff").describe("Background/gap color"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          // Resolve and validate all sources
          args.paths = args.paths.map((p: string) => resolvePath(p))
          for (const p of args.paths) {
            const err = validateSourceImage(p)
            if (err) return errorResult(err)
          }

          try {
            // Get metadata for all images
            const metas = await Promise.all(
              args.paths.map(async (p) => {
                const m = await sharp(p).metadata()
                return { path: p, width: m.width || 0, height: m.height || 0 }
              }),
            )

            const isHorizontal = args.direction === "horizontal"
            const totalGap = args.gap * (metas.length - 1)

            let canvasWidth: number
            let canvasHeight: number

            if (isHorizontal) {
              canvasWidth = metas.reduce((sum, m) => sum + m.width, 0) + totalGap
              canvasHeight = Math.max(...metas.map((m) => m.height))
            } else {
              canvasWidth = Math.max(...metas.map((m) => m.width))
              canvasHeight = metas.reduce((sum, m) => sum + m.height, 0) + totalGap
            }

            // Parse background color
            const bg = args.background
            const r = parseInt(bg.slice(1, 3), 16) || 255
            const g = parseInt(bg.slice(3, 5), 16) || 255
            const b = parseInt(bg.slice(5, 7), 16) || 255

            // Build composite inputs
            const compositeInputs: sharp.OverlayOptions[] = []
            let offset = 0

            for (const m of metas) {
              const input = await sharp(m.path).toBuffer()
              if (isHorizontal) {
                compositeInputs.push({ input, left: offset, top: 0 })
              } else {
                compositeInputs.push({ input, left: 0, top: offset })
              }
              offset += (isHorizontal ? m.width : m.height) + args.gap
            }

            const outputPath = resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.paths[0], "concat")
            const info = await sharp({
              create: {
                width: canvasWidth,
                height: canvasHeight,
                channels: 3,
                background: { r, g, b },
              },
            })
              .composite(compositeInputs)
              .toFile(outputPath)

            notifyFileChanged(outputPath, context.subChatId, "Concat", `Concatenated ${metas.length} images ${args.direction}ly`)
            return successResult(
              outputPath,
              `${metas.length} images concatenated ${args.direction}ly → ${info.width}x${info.height} (${formatBytes(info.size)})`,
            )
          } catch (error) {
            return errorResult(`Image concat error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_watermark — 文字水印
      // ================================================================
      tool(
        "image_watermark",
        `Add a text watermark to an image.

【When to Use】
- When adding copyright or branding text to images
- When marking images as drafts or confidential

【Parameters】
- path: Absolute path to the source image
- text: Watermark text
- position: "center", "top-left", "top-right", "bottom-left", "bottom-right" (default "bottom-right")
- opacity: Watermark opacity 0.0-1.0 (default 0.3)
- font_size: Font size in pixels (default 24)
- color: Text color hex (default "#ffffff")
- output_path: Optional output path

【Example】
image_watermark(path="/path/to/photo.jpg", text="© 2024 Company", position="bottom-right")`,
        {
          path: z.string().describe("Absolute path to the source image"),
          text: z.string().describe("Watermark text"),
          position: z
            .enum(["center", "top-left", "top-right", "bottom-left", "bottom-right"])
            .default("bottom-right")
            .describe("Watermark position"),
          opacity: z.number().min(0).max(1).default(0.3).describe("Watermark opacity (0.0-1.0)"),
          font_size: z.number().int().min(8).max(200).default(24).describe("Font size in pixels"),
          color: z.string().default("#ffffff").describe("Text color (hex)"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            const meta = await sharp(args.path).metadata()
            const w = meta.width || 800
            const h = meta.height || 600

            const svgBuf = buildWatermarkSvg(w, h, args.text, args.position, args.opacity, args.font_size, args.color)

            const outputPath = resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.path, "watermarked")
            const info = await sharp(args.path)
              .composite([{ input: svgBuf, top: 0, left: 0 }])
              .toFile(outputPath)

            notifyFileChanged(outputPath, context.subChatId, "Watermark", `Watermark: "${args.text}"`)
            return successResult(outputPath, `Watermark "${args.text}" added at ${args.position} (${formatBytes(info.size)})`)
          } catch (error) {
            return errorResult(`Image watermark error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_annotate — 标注（矩形框+文字+箭头）
      // ================================================================
      tool(
        "image_annotate",
        `Add annotations to an image: rectangles, arrows, and text labels. Great for bug reports, tutorials, and highlighting specific areas.

【When to Use】
- When highlighting UI elements or areas of interest in screenshots
- When creating bug reports with visual annotations
- When making tutorial screenshots with callouts
- When pointing out specific details with arrows and labels

【Parameters】
- path: Absolute path to the source image
- annotations: Array of annotation objects, each with:
  - type: "rect" | "arrow" | "text"
  - x, y: Position (required for all types)
  - w, h: Width/height (required for rect)
  - x2, y2: End point (required for arrow)
  - text: Label text (required for text type)
  - color: Color hex (default "#ff0000")
  - stroke_width: Line width (default 3)
  - font_size: Text size (default 16)
- output_path: Optional output path

【Example】
image_annotate(path="/path/to/screenshot.png", annotations=[
  {type: "rect", x: 100, y: 50, w: 200, h: 100, color: "#ff0000"},
  {type: "arrow", x: 400, y: 200, x2: 200, y2: 100, color: "#ff0000"},
  {type: "text", x: 100, y: 40, text: "Bug here!", color: "#ff0000", font_size: 20}
])`,
        {
          path: z.string().describe("Absolute path to the source image"),
          annotations: z
            .array(
              z.object({
                type: z.enum(["rect", "arrow", "text"]),
                x: z.number().optional(),
                y: z.number().optional(),
                w: z.number().optional().describe("Width (rect only)"),
                h: z.number().optional().describe("Height (rect only)"),
                x2: z.number().optional().describe("Arrow end X"),
                y2: z.number().optional().describe("Arrow end Y"),
                text: z.string().optional().describe("Text content (text type)"),
                color: z.string().default("#ff0000").describe("Color hex"),
                stroke_width: z.number().default(3).describe("Line width"),
                font_size: z.number().default(16).describe("Text font size"),
              }),
            )
            .min(1)
            .describe("Array of annotations"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            const meta = await sharp(args.path).metadata()
            const w = meta.width || 800
            const h = meta.height || 600

            const svgBuf = buildAnnotationSvg(w, h, args.annotations as any)

            const outputPath = resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.path, "annotated")
            const info = await sharp(args.path)
              .composite([{ input: svgBuf, top: 0, left: 0 }])
              .toFile(outputPath)

            const counts = {
              rect: args.annotations.filter((a) => a.type === "rect").length,
              arrow: args.annotations.filter((a) => a.type === "arrow").length,
              text: args.annotations.filter((a) => a.type === "text").length,
            }
            const desc = Object.entries(counts)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${v} ${k}(s)`)
              .join(", ")

            notifyFileChanged(outputPath, context.subChatId, "Annotate", `Annotated with ${desc}`)
            return successResult(outputPath, `Image annotated with ${desc} (${info.width}x${info.height}, ${formatBytes(info.size)})`)
          } catch (error) {
            return errorResult(`Image annotate error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_thumbnail — 生成缩略图
      // ================================================================
      tool(
        "image_thumbnail",
        `Generate a square thumbnail from an image. The image is resized to fit within the specified size while maintaining aspect ratio.

【When to Use】
- When creating thumbnails for image galleries
- When generating preview images
- When creating icons from larger images

【Parameters】
- path: Absolute path to the source image
- size: Thumbnail size in pixels (both width and height limit, default 256)
- output_path: Optional output path

【Example】
image_thumbnail(path="/path/to/photo.jpg", size=128)`,
        {
          path: z.string().describe("Absolute path to the source image"),
          size: z.number().int().positive().default(256).describe("Thumbnail size in pixels"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          args.path = resolvePath(args.path)
          const err = validateSourceImage(args.path)
          if (err) return errorResult(err)

          try {
            const outputPath = resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.path, `thumb-${args.size}`)
            const info = await sharp(args.path)
              .resize(args.size, args.size, { fit: "inside" })
              .toFile(outputPath)

            notifyFileChanged(outputPath, context.subChatId, "Thumbnail", `Thumbnail ${args.size}px`)
            return successResult(outputPath, `Thumbnail generated: ${info.width}x${info.height} (${formatBytes(info.size)})`)
          } catch (error) {
            return errorResult(`Image thumbnail error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),

      // ================================================================
      // image_composite — 图片合成/叠加
      // ================================================================
      tool(
        "image_composite",
        `Composite (overlay) one image onto another. Useful for logos, overlays, and combining image layers.

【When to Use】
- When adding a logo to an image
- When overlaying one image on top of another
- When combining multiple image layers

【Parameters】
- base_image: Absolute path to the base (background) image
- overlay_image: Absolute path to the overlay (foreground) image
- left: X position for overlay (default 0, ignored if gravity is set)
- top: Y position for overlay (default 0, ignored if gravity is set)
- gravity: Placement gravity - "northwest", "north", "northeast", "west", "center", "east", "southwest", "south", "southeast". Overrides left/top
- opacity: Overlay opacity 0.0-1.0 (default 1.0)
- output_path: Optional output path

【Example】
image_composite(base_image="/path/to/photo.jpg", overlay_image="/path/to/logo.png", gravity="southeast", opacity=0.5)`,
        {
          base_image: z.string().describe("Absolute path to the base image"),
          overlay_image: z.string().describe("Absolute path to the overlay image"),
          left: z.number().int().default(0).describe("X position for overlay"),
          top: z.number().int().default(0).describe("Y position for overlay"),
          gravity: z
            .enum([
              "northwest", "north", "northeast",
              "west", "center", "east",
              "southwest", "south", "southeast",
            ])
            .optional()
            .describe("Placement gravity (overrides left/top)"),
          opacity: z.number().min(0).max(1).default(1.0).describe("Overlay opacity (0.0-1.0)"),
          output_path: z.string().optional().describe("Output file path"),
        },
        async (args): Promise<ToolResult> => {
          args.base_image = resolvePath(args.base_image)
          args.overlay_image = resolvePath(args.overlay_image)
          const baseErr = validateSourceImage(args.base_image)
          if (baseErr) return errorResult(baseErr)
          const overlayErr = validateSourceImage(args.overlay_image)
          if (overlayErr) return errorResult(overlayErr)

          try {
            // Prepare overlay with opacity
            let overlayBuf: Buffer
            if (args.opacity < 1.0) {
              overlayBuf = await sharp(args.overlay_image)
                .ensureAlpha(args.opacity)
                .toBuffer()
            } else {
              overlayBuf = await sharp(args.overlay_image).toBuffer()
            }

            const compositeOpts: sharp.OverlayOptions = { input: overlayBuf }

            if (args.gravity) {
              compositeOpts.gravity = args.gravity
            } else {
              compositeOpts.left = args.left
              compositeOpts.top = args.top
            }

            const outputPath = resolveOutputPathArg(args.output_path, context.cwd) || resolveOutputPath(args.base_image, "composite")
            const info = await sharp(args.base_image)
              .composite([compositeOpts])
              .toFile(outputPath)

            notifyFileChanged(outputPath, context.subChatId, "Composite", "Image composite")
            return successResult(
              outputPath,
              `Image composited (${info.width}x${info.height}, ${formatBytes(info.size)})`,
            )
          } catch (error) {
            return errorResult(`Image composite error: ${error instanceof Error ? error.message : "Unknown error"}`)
          }
        },
      ),
    ]
}

export async function createImageProcessMcpServer(context: ImageProcessMcpContext) {
  const { createSdkMcpServer } = await getSdkModule()
  const tools = await getImageProcessToolDefinitions(context)

  return createSdkMcpServer({
    name: "image-process",
    version: "1.0.0",
    tools,
  })
}
