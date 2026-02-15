import { atom } from "jotai"
import type { MCPServer } from "./session-info"

/**
 * MCP 服务器实时状态 Map
 * Key: 服务器名称, Value: 服务器状态
 */
export const mcpStatusMapAtom = atom<Map<string, MCPServer>>(new Map())

/**
 * MCP 预热状态
 */
export const mcpWarmupStateAtom = atom<"idle" | "warming" | "completed" | "failed">("idle")
