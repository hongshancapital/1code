/**
 * 数据导出器
 * 将聊天记录导出到临时目录供 Agent 读取
 */

import { app } from "electron"
import { mkdir, writeFile, rm } from "fs/promises"
import { join } from "path"
import { and, gte, lte, eq } from "drizzle-orm"
import { getDatabase, projects, chats, subChats } from "../../../lib/db"
import type { InsightStats, ReportType } from "./types"
import { createLogger } from "../../../lib/logger"

const insightsLog = createLogger("Insights")


export interface ExportedChat {
  chatId: string
  chatName: string | null
  projectId: string
  projectName: string
  projectPath: string
  subChats: Array<{
    id: string
    name: string | null
    mode: string
    messages: unknown[]
    createdAt: string
    updatedAt: string
  }>
  createdAt: string
  updatedAt: string
}

export interface ExportResult {
  dataDir: string
  statsFile: string
  chatFiles: string[]
  totalMessages: number
  totalChats: number
}

/**
 * 生成数据导出目录路径
 */
function getDataDir(reportType: ReportType, reportDate: string): string {
  const timestamp = Date.now()
  return join(
    app.getPath("userData"),
    "insights",
    `${reportType}-${reportDate}-${timestamp}`
  )
}

/**
 * 导出指定时间范围内的聊天数据到临时目录
 */
export async function exportChatData(
  startDate: Date,
  endDate: Date,
  reportType: ReportType,
  reportDate: string,
  stats: InsightStats
): Promise<ExportResult> {
  const db = getDatabase()
  const dataDir = getDataDir(reportType, reportDate)
  const chatsDir = join(dataDir, "chats")

  // 创建目录结构
  await mkdir(dataDir, { recursive: true })
  await mkdir(chatsDir, { recursive: true })

  // 保存统计数据
  const statsFile = join(dataDir, "stats.json")
  await writeFile(statsFile, JSON.stringify(stats, null, 2), "utf-8")

  // 查询时间范围内有活动的聊天
  // 基于 subChats 的更新时间来判断是否有活动
  const activeSubChats = db
    .select({
      subChatId: subChats.id,
      subChatName: subChats.name,
      chatId: subChats.chatId,
      mode: subChats.mode,
      messages: subChats.messages,
      subChatCreatedAt: subChats.createdAt,
      subChatUpdatedAt: subChats.updatedAt,
    })
    .from(subChats)
    .where(
      and(
        gte(subChats.updatedAt, startDate),
        lte(subChats.updatedAt, endDate)
      )
    )
    .all()

  // 收集所有活跃的 chatId
  const activeChatIds = [...new Set(activeSubChats.map((sc) => sc.chatId))]

  if (activeChatIds.length === 0) {
    return {
      dataDir,
      statsFile,
      chatFiles: [],
      totalMessages: 0,
      totalChats: 0,
    }
  }

  // 查询这些 chats 的详细信息和关联的项目
  const chatDetails = db
    .select({
      chatId: chats.id,
      chatName: chats.name,
      projectId: chats.projectId,
      projectName: projects.name,
      projectPath: projects.path,
      chatCreatedAt: chats.createdAt,
      chatUpdatedAt: chats.updatedAt,
    })
    .from(chats)
    .leftJoin(projects, eq(chats.projectId, projects.id))
    .all()
    .filter((c) => activeChatIds.includes(c.chatId))

  // 按项目分组导出
  const projectChatsMap = new Map<string, ExportedChat[]>()
  let totalMessages = 0
  const chatFiles: string[] = []

  for (const chat of chatDetails) {
    const chatSubChats = activeSubChats.filter((sc) => sc.chatId === chat.chatId)

    const exportedChat: ExportedChat = {
      chatId: chat.chatId,
      chatName: chat.chatName,
      projectId: chat.projectId,
      projectName: chat.projectName ?? "Unknown",
      projectPath: chat.projectPath ?? "",
      subChats: chatSubChats.map((sc) => {
        let messages: unknown[] = []
        try {
          messages = JSON.parse(sc.messages ?? "[]")
        } catch {
          messages = []
        }
        totalMessages += messages.length
        return {
          id: sc.subChatId,
          name: sc.subChatName,
          mode: sc.mode,
          messages,
          createdAt: sc.subChatCreatedAt?.toISOString() ?? "",
          updatedAt: sc.subChatUpdatedAt?.toISOString() ?? "",
        }
      }),
      createdAt: chat.chatCreatedAt?.toISOString() ?? "",
      updatedAt: chat.chatUpdatedAt?.toISOString() ?? "",
    }

    const projectKey = chat.projectId
    if (!projectChatsMap.has(projectKey)) {
      projectChatsMap.set(projectKey, [])
    }
    projectChatsMap.get(projectKey)!.push(exportedChat)
  }

  // 写入按项目分组的聊天文件
  for (const [projectId, projectChats] of projectChatsMap) {
    const projectName = projectChats[0]?.projectName ?? "unknown"
    const safeProjectName = projectName.replace(/[^a-zA-Z0-9\u4e00-\u9fff-_]/g, "_")
    const fileName = `${safeProjectName}-${projectId.slice(0, 8)}.json`
    const filePath = join(chatsDir, fileName)

    await writeFile(
      filePath,
      JSON.stringify(
        {
          projectId,
          projectName,
          projectPath: projectChats[0]?.projectPath ?? "",
          chats: projectChats,
        },
        null,
        2
      ),
      "utf-8"
    )
    chatFiles.push(filePath)
  }

  // 写入索引文件
  const indexFile = join(dataDir, "index.json")
  await writeFile(
    indexFile,
    JSON.stringify(
      {
        reportType,
        reportDate,
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
        projects: Array.from(projectChatsMap.entries()).map(([projectId, chats]) => ({
          projectId,
          projectName: chats[0]?.projectName ?? "Unknown",
          chatCount: chats.length,
          subChatCount: chats.reduce((sum, c) => sum + c.subChats.length, 0),
        })),
        totalChats: activeChatIds.length,
        totalSubChats: activeSubChats.length,
        totalMessages,
      },
      null,
      2
    ),
    "utf-8"
  )

  return {
    dataDir,
    statsFile,
    chatFiles,
    totalMessages,
    totalChats: activeChatIds.length,
  }
}

/**
 * 清理数据导出目录
 */
export async function cleanupDataDir(dataDir: string): Promise<void> {
  try {
    await rm(dataDir, { recursive: true, force: true })
  } catch (error) {
    insightsLog.warn("Failed to cleanup data dir:", dataDir, error)
  }
}

/**
 * 清理超过 N 天的旧数据目录
 */
export async function cleanupOldDataDirs(daysToKeep = 7): Promise<void> {
  const { readdir, stat } = await import("fs/promises")
  const insightsDir = join(app.getPath("userData"), "insights")

  try {
    const entries = await readdir(insightsDir, { withFileTypes: true })
    const now = Date.now()
    const maxAge = daysToKeep * 24 * 60 * 60 * 1000

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = join(insightsDir, entry.name)
        try {
          const dirStat = await stat(dirPath)
          if (now - dirStat.mtimeMs > maxAge) {
            await rm(dirPath, { recursive: true, force: true })
            insightsLog.info("Cleaned up old data dir:", entry.name)
          }
        } catch {
          // Ignore stat errors
        }
      }
    }
  } catch {
    // Directory might not exist yet
  }
}
