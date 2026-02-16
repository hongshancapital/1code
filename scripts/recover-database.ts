/**
 * 数据库恢复脚本
 * 从 session 文件和项目配置重建数据库
 */

import { app } from "electron"
import path from "path"
import fs from "fs/promises"
import { getDatabase } from "../src/main/lib/db"
import { projects, chats, subChats } from "../src/main/lib/db/schema"

async function recoverDatabase() {
  console.log("[Recover] Starting database recovery...")

  const db = getDatabase()

  // 1. 扫描 ~/.claude/projects/ 目录，找到所有 session 文件
  const claudeConfigDir = path.join(app.getPath("userData"), ".claude")
  const projectsDir = path.join(claudeConfigDir, "projects")

  try {
    const projectFolders = await fs.readdir(projectsDir)
    console.log(`[Recover] Found ${projectFolders.length} project folders`)

    for (const projectFolder of projectFolders) {
      const projectPath = path.join(projectsDir, projectFolder)
      const sessionFiles = await fs.readdir(projectPath).catch(() => [])

      for (const sessionFile of sessionFiles) {
        if (sessionFile.endsWith(".jsonl")) {
          const sessionPath = path.join(projectPath, sessionFile)
          const sessionId = sessionFile.replace(".jsonl", "")

          console.log(`[Recover] Processing session: ${sessionId}`)

          // 读取 session 文件
          const content = await fs.readFile(sessionPath, "utf-8")
          const lines = content.trim().split("\n")

          // 解析消息
          const messages: any[] = []
          for (const line of lines) {
            try {
              const msg = JSON.parse(line)
              messages.push(msg)
            } catch {
              // Skip invalid lines
            }
          }

          if (messages.length === 0) continue

          // TODO: 从 messages 中提取信息，重建数据库记录
          // 需要推断 project, chat, subchat
        }
      }
    }

    console.log("[Recover] Recovery completed!")
  } catch (error) {
    console.error("[Recover] Error:", error)
  }
}

// Run recovery
recoverDatabase().catch(console.error)
