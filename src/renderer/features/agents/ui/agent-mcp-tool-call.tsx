"use client"

import { useAtomValue } from "jotai"
import { memo, useState } from "react"
import { OriginalMCPIcon } from "../../../icons/icons"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { sessionInfoAtom, type MCPServer } from "../../../lib/atoms"
import { getToolStatus } from "./agent-tool-registry"
import { AgentImageItem } from "./agent-image-item"

interface AgentMcpToolCallProps {
  /** Full tool type, e.g. "tool-mcp__time-mcp__current_time" */
  toolType: string
  part: any
  chatStatus?: string
}

/**
 * Parse MCP tool type to extract server name and tool name.
 * Format: "tool-mcp__servername__toolname" or "mcp__servername__toolname"
 */
function parseMcpToolType(toolType: string): { serverName: string; toolName: string } | null {
  // Remove "tool-" prefix if present
  const normalized = toolType.startsWith("tool-") ? toolType.slice(5) : toolType

  if (!normalized.startsWith("mcp__")) return null

  const parts = normalized.split("__")
  if (parts.length < 3) return null

  return {
    serverName: parts[1],
    toolName: parts.slice(2).join("__"),
  }
}

/**
 * Format tool name for display: replace underscores with spaces and capitalize.
 */
function formatToolName(toolName: string): string {
  return toolName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Get the best icon URL for an MCP server.
 * Prefers SVG, then picks the largest raster icon.
 */
function getServerIconUrl(server: MCPServer): string | null {
  const icons = server.serverInfo?.icons
  if (!icons || icons.length === 0) return null

  // Prefer SVG
  const svg = icons.find((i) => i.mimeType === "image/svg+xml")
  if (svg) return svg.src

  // Otherwise pick the one with the largest size, or first available
  let best = icons[0]
  let bestSize = 0
  for (const icon of icons) {
    if (icon.sizes?.length) {
      const size = parseInt(icon.sizes[0], 10) || 0
      if (size > bestSize) {
        bestSize = size
        best = icon
      }
    }
  }
  return best.src
}

function ServerIcon({ server }: { server: MCPServer | undefined }) {
  const [imgError, setImgError] = useState(false)
  const iconUrl = server ? getServerIconUrl(server) : null

  if (iconUrl && !imgError) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="h-3.5 w-3.5 shrink-0 rounded-sm object-contain"
        onError={() => setImgError(true)}
      />
    )
  }

  return <OriginalMCPIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
}

/**
 * Extract image file paths from MCP tool output text.
 * Looks for patterns like "saved to: /absolute/path/to/image.png" in text output items.
 * Also supports legacy base64 image content for backward compatibility.
 */
function extractOutputImages(part: any): Array<{ id: string; filename: string; url: string }> {
  if (part.state !== "output-available") return []

  const output = part.output
  if (!output) return []

  const items = Array.isArray(output) ? output : [output]
  const images: Array<{ id: string; filename: string; url: string }> = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    // Extract file paths from text output (primary method — no base64 in context)
    if (item?.type === "text" && typeof item.text === "string") {
      const pathMatch = item.text.match(/saved to:\s*(\/[^\s\n]+\.(?:png|jpg|jpeg|gif|webp))/i)
      if (pathMatch) {
        const filePath = pathMatch[1]
        const filename = filePath.split("/").pop() || "image.png"
        images.push({
          id: `${part.toolCallId}-img-${i}`,
          filename,
          url: `local-file://localhost${filePath}`,
        })
      }
      continue
    }

    // Legacy: base64 image content (backward compatibility)
    if (item?.type !== "image") continue

    let dataUrl: string | null = null
    if (item.source?.type === "base64" && item.source.data) {
      dataUrl = `data:${item.source.media_type || "image/png"};base64,${item.source.data}`
    } else if (item.data && item.mimeType) {
      dataUrl = `data:${item.mimeType};base64,${item.data}`
    }

    if (dataUrl) {
      images.push({
        id: `${part.toolCallId}-img-${i}`,
        filename: `generated-image-${i + 1}.png`,
        url: dataUrl,
      })
    }
  }

  return images
}

export const AgentMcpToolCall = memo(
  function AgentMcpToolCall({ toolType, part, chatStatus }: AgentMcpToolCallProps) {
    const sessionInfo = useAtomValue(sessionInfoAtom)
    const parsed = parseMcpToolType(toolType)

    if (!parsed) {
      // Fallback for unparseable MCP tools
      return (
        <div className="text-xs text-muted-foreground py-0.5 px-2">
          {toolType.replace("tool-", "")}
        </div>
      )
    }

    const { serverName, toolName } = parsed
    const { isPending, isError: _isError } = getToolStatus(part, chatStatus)

    // Find MCP server info from session
    const server = sessionInfo?.mcpServers?.find((s) => s.name === serverName)

    // Format display text
    const displayToolName = formatToolName(toolName)
    const title = isPending ? `${displayToolName}...` : displayToolName

    // Extract images from MCP tool output
    const outputImages = extractOutputImages(part)

    return (
      <div className="space-y-2" data-tool-call-id={part.toolCallId}>
        <div className="flex items-start gap-1.5 py-0.5 rounded-md px-2">
          {/* MCP Server Icon */}
          <div className="shrink-0 flex text-muted-foreground items-center pt-px">
            <ServerIcon server={server} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
              <span className="font-medium whitespace-nowrap shrink-0">
                {isPending ? (
                  <TextShimmer
                    as="span"
                    duration={1.2}
                    className="inline-flex items-center text-xs leading-none h-4 m-0"
                  >
                    {title}
                  </TextShimmer>
                ) : (
                  title
                )}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground/60 font-normal truncate min-w-0">
                    {serverName}
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="px-2 py-1.5 max-w-none flex items-center justify-center"
                >
                  <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap leading-none">
                    {toolType.replace("tool-", "")}
                  </span>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Render output images */}
        {outputImages.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2">
            {outputImages.map((img, idx) => (
              <AgentImageItem
                key={img.id}
                id={img.id}
                filename={img.filename}
                url={img.url}
                allImages={outputImages}
                imageIndex={idx}
              />
            ))}
          </div>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.toolType === nextProps.toolType &&
      prevProps.part?.state === nextProps.part?.state &&
      prevProps.chatStatus === nextProps.chatStatus
    )
  },
)

/**
 * Check if a tool type is an MCP tool.
 */
export function isMcpTool(toolType: string): boolean {
  const normalized = toolType.startsWith("tool-") ? toolType.slice(5) : toolType
  return normalized.startsWith("mcp__")
}
