# 自动化引擎系统设计文档

## 1. 系统概述

自动化引擎是 1code 应用中的一个智能任务自动化系统，支持：
- **触发器**：定时任务（cron）、Webhook、API 调用、信号
- **处理层**：通过 Claude AI 处理 Prompt + Skills
- **执行器**：创建 Inbox 消息、API 调用、文件操作、MCP 调用、HTTP 请求

### 1.1 当前实现状态

| 功能 | 状态 | 说明 |
|------|------|------|
| Cron 触发器 | ✅ 已实现 | 支持 cron 表达式，时区 Asia/Shanghai |
| 启动补偿 | ✅ 已实现 | 非严格模式下补偿执行错过的任务 |
| Claude AI 处理 | ✅ 已实现 | 调用 Anthropic API 处理 prompt |
| Inbox 消息执行器 | ✅ 已实现 | 创建 Chat 并关联到 Inbox 项目 |
| tRPC API | ✅ 已实现 | CRUD + 手动触发 + 查询 |
| Webhook 触发器 | ❌ 待实现 | |
| API/HTTP 执行器 | ❌ 待实现 | |
| MCP 工具执行器 | ❌ 待实现 | |
| Skills 集成 | ❌ 待实现 | |

## 2. 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        触发器层 (Triggers)                        │
├─────────────┬─────────────┬─────────────┬─────────────────────────┤
│   Cron ✅   │  Webhook ❌  │   API ❌    │      Signal ❌          │
└──────┬──────┴──────┬──────┴──────┬──────┴───────────┬─────────────┘
       │             │             │                  │
       └─────────────┴─────────────┴──────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    自动化引擎 (AutomationEngine)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Scheduler   │  │ AI Invoker  │  │   Action Executor       │  │
│  │ (node-cron) │  │ (Anthropic) │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        执行器层 (Actions)                         │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│  Inbox ✅   │   API ❌    │   File ❌   │   MCP ❌    │ HTTP ❌  │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        数据层 (SQLite)                           │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐  │
│  │   automations   │  │       automation_executions          │  │
│  └─────────────────┘  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 文件结构

```
src/main/lib/
├── automation/
│   ├── index.ts           # 模块导出
│   ├── types.ts           # TypeScript 类型定义
│   ├── inbox-project.ts   # Inbox 特殊项目初始化
│   ├── scheduler.ts       # Cron 定时任务调度器
│   └── engine.ts          # 自动化引擎核心（单例）
├── db/
│   ├── index.ts           # 数据库初始化（含自动表创建）
│   └── schema/
│       └── index.ts       # Drizzle ORM Schema
└── trpc/
    └── routers/
        ├── index.ts       # 路由注册
        └── automations.ts # 自动化 tRPC API

drizzle/
├── 0009_add_automations.sql  # 迁移文件
└── meta/
    └── _journal.json         # 迁移记录

src/renderer/features/automations/
├── inbox-view.tsx         # Inbox 视图（已连接本地 tRPC）
└── inbox-styles.css       # 样式

src/main/index.ts          # 应用入口（自动化引擎初始化/清理）
```

## 4. 数据模型

### 4.1 automations 表

```sql
CREATE TABLE automations (
  id TEXT PRIMARY KEY,                    -- 自动生成的 ID
  name TEXT NOT NULL,                     -- 自动化名称
  description TEXT,                       -- 描述
  is_enabled INTEGER DEFAULT 1,           -- 是否启用
  triggers TEXT NOT NULL DEFAULT '[]',    -- 触发器配置 (JSON)
  agent_prompt TEXT NOT NULL,             -- AI 处理的 Prompt
  skills TEXT DEFAULT '[]',               -- 技能列表 (JSON，待实现)
  model_id TEXT DEFAULT 'claude-opus-4-20250514', -- Claude 模型
  actions TEXT NOT NULL DEFAULT '[]',     -- 执行器配置 (JSON)
  project_id TEXT,                        -- 关联项目（可选）
  created_at INTEGER NOT NULL,            -- 创建时间
  updated_at INTEGER NOT NULL,            -- 更新时间
  last_triggered_at INTEGER,              -- 最后触发时间
  total_executions INTEGER DEFAULT 0,     -- 总执行次数
  successful_executions INTEGER DEFAULT 0,-- 成功次数
  failed_executions INTEGER DEFAULT 0     -- 失败次数
);
```

### 4.2 automation_executions 表

```sql
CREATE TABLE automation_executions (
  id TEXT PRIMARY KEY,                    -- 执行 ID
  automation_id TEXT NOT NULL,            -- 关联的自动化 ID
  status TEXT NOT NULL,                   -- 状态: pending/running/success/failed
  triggered_by TEXT NOT NULL,             -- 触发方式: cron/webhook/startup-missed/manual
  trigger_data TEXT,                      -- 触发数据 (JSON)
  result TEXT,                            -- 执行结果 (JSON)
  error_message TEXT,                     -- 错误信息
  inbox_chat_id TEXT,                     -- 关联的 Inbox Chat ID
  started_at INTEGER NOT NULL,            -- 开始时间
  completed_at INTEGER,                   -- 完成时间
  duration_ms INTEGER,                    -- 执行耗时（毫秒）
  input_tokens INTEGER DEFAULT 0,         -- 输入 Token 数
  output_tokens INTEGER DEFAULT 0         -- 输出 Token 数
);

CREATE INDEX executions_automation_idx ON automation_executions(automation_id);
CREATE INDEX executions_status_idx ON automation_executions(status);
```

### 4.3 Inbox 特殊项目

```typescript
// 固定 ID，用于标识 Inbox 消息
const INBOX_PROJECT_ID = "inbox-special-project"

// projects 表中的记录
{
  id: "inbox-special-project",
  name: "Inbox",
  path: "/inbox",
  mode: "chat",
  isPlayground: false
}
```

## 5. TypeScript 类型定义

```typescript
// src/main/lib/automation/types.ts

export interface TriggerData {
  triggeredBy: "cron" | "webhook" | "startup-missed" | "manual"
  triggerData?: Record<string, any>
}

export interface TriggerConfig {
  type: "cron" | "webhook" | "api" | "signal"
  config: Record<string, any>
}

export interface ActionConfig {
  type: "inbox" | "api" | "file" | "mcp" | "http"
  config: Record<string, any>
}

// Cron 触发器配置
interface CronTriggerConfig {
  type: "cron"
  config: {
    expression: string  // cron 表达式，如 "0 9 * * *"
    strict: boolean     // 严格模式：true=错过跳过，false=启动补偿
  }
}

// Inbox 执行器配置
interface InboxActionConfig {
  type: "inbox"
  config: {}  // 暂无额外配置
}
```

## 6. tRPC API

### 6.1 路由定义

```typescript
// src/main/lib/trpc/routers/automations.ts

automationsRouter = router({
  // 列出所有自动化
  list: publicProcedure.query(),

  // 创建自动化
  create: publicProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      triggers: z.array(z.any()),
      agentPrompt: z.string(),
      skills: z.array(z.string()).optional(),
      actions: z.array(z.any()),
    }))
    .mutation(),

  // 更新自动化
  update: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      isEnabled: z.boolean().optional(),
      triggers: z.array(z.any()).optional(),
      agentPrompt: z.string().optional(),
      actions: z.array(z.any()).optional(),
    }))
    .mutation(),

  // 删除自动化
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(),

  // 获取 Inbox 消息列表
  getInboxChats: publicProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(),

  // 获取执行历史
  listExecutions: publicProcedure
    .input(z.object({
      automationId: z.string().optional(),
      limit: z.number().default(20),
    }))
    .query(),

  // 手动触发
  trigger: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(),
})
```

### 6.2 使用示例

```typescript
import { trpc } from '@/lib/trpc'

// 创建自动化
const automation = await trpc.automations.create.mutate({
  name: "每日早报",
  triggers: [{
    type: "cron",
    config: { expression: "0 9 * * *", strict: false }
  }],
  agentPrompt: "生成今日新闻摘要",
  actions: [{ type: "inbox", config: {} }]
})

// 手动触发
await trpc.automations.trigger.mutate({ id: automation.id })

// 查看 Inbox
const inbox = await trpc.automations.getInboxChats.query({ limit: 50 })

// 查看执行历史
const history = await trpc.automations.listExecutions.query({
  automationId: automation.id,
  limit: 20
})
```

## 7. 核心类

### 7.1 AutomationEngine（单例）

```typescript
// src/main/lib/automation/engine.ts

class AutomationEngine {
  private static instance: AutomationEngine
  public scheduler = new SchedulerService()
  private anthropic: Anthropic | null = null

  static getInstance(): AutomationEngine

  // 初始化（应用启动时调用）
  async initialize(apiKey?: string): Promise<void>

  // 注册触发器
  async registerTriggers(automationId: string, triggers: TriggerConfig[]): Promise<void>

  // 执行自动化
  async executeAutomation(automationId: string, triggerData: TriggerData): Promise<string>

  // 清理资源（应用关闭时调用）
  cleanup(): void
}
```

### 7.2 SchedulerService

```typescript
// src/main/lib/automation/scheduler.ts

class SchedulerService {
  private tasks = new Map<string, cron.ScheduledTask[]>()
  private engine: AutomationEngine | null = null

  setEngine(engine: AutomationEngine): void

  // 注册 cron 触发器
  registerCronTrigger(automationId: string, expression: string, strict: boolean): void

  // 取消注册
  unregisterAutomation(automationId: string): void

  // 检查错过的任务（启动时调用）
  async checkMissedTasks(): Promise<void>

  // 清理所有任务
  cleanup(): void
}
```

## 8. 初始化流程

```
应用启动
    │
    ▼
initDatabase()
    │ - 创建 SQLite 连接
    │ - 运行 Drizzle 迁移
    │ - 确保 automations 表存在
    │
    ▼
ensureInboxProject()
    │ - 检查/创建 inbox-special-project
    │
    ▼
AutomationEngine.getInstance().initialize(apiKey)
    │ - 创建 Anthropic 客户端（如果有 API key）
    │ - 加载所有启用的自动化
    │ - 注册 cron 触发器
    │ - 检查并执行错过的任务
    │
    ▼
应用运行中...
    │ - cron 任务按计划执行
    │ - 用户可通过 tRPC 管理自动化
    │
    ▼
应用关闭
    │
    ▼
AutomationEngine.getInstance().cleanup()
    │ - 停止所有 cron 任务
    │
    ▼
closeDatabase()
```

## 9. 执行流程

```
触发（cron/manual/startup-missed）
    │
    ▼
executeAutomation(automationId, triggerData)
    │
    ├─► 1. 创建执行记录 (status: "running")
    │
    ├─► 2. 加载自动化配置
    │
    ├─► 3. 调用 Claude AI
    │       │ - model: automation.modelId
    │       │ - prompt: automation.agentPrompt
    │       │ - max_tokens: 1024
    │       └─► 返回 AI 响应文本
    │
    ├─► 4. 执行 Actions
    │       │ - 遍历 automation.actions
    │       │ - 类型为 "inbox" 时：
    │       │     ├─ 创建 Chat (projectId: inbox-special-project)
    │       │     ├─ 创建 SubChat (包含 AI 响应)
    │       │     └─ 关联到执行记录
    │       └─► 返回执行结果
    │
    ├─► 5. 更新执行状态 (status: "success")
    │
    └─► 6. 更新自动化统计
            - lastTriggeredAt
            - totalExecutions++
            - successfulExecutions++

    [如果失败]
    ├─► 更新执行状态 (status: "failed", errorMessage)
    └─► 更新自动化统计 (failedExecutions++)
```

## 10. 环境变量

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...  # Anthropic API Key（可选，用于 AI 处理）
```

## 11. 依赖

```json
{
  "dependencies": {
    "node-cron": "^4.2.1",
    "@anthropic-ai/sdk": "^0.72.1"
  },
  "devDependencies": {
    "@types/node-cron": "^3.0.11"
  }
}
```

## 12. 待实现功能

### 12.1 Webhook 触发器

```typescript
// 需要实现 WebhookService
class WebhookService {
  // Express 服务器接收 HTTP 请求
  // 验证签名
  // 触发对应自动化
}
```

### 12.2 其他执行器

```typescript
// API 调用执行器
interface ApiActionConfig {
  type: "api"
  config: {
    url: string
    method: "GET" | "POST" | "PUT" | "DELETE"
    headers?: Record<string, string>
    body?: any
  }
}

// HTTP 请求执行器
interface HttpActionConfig {
  type: "http"
  config: {
    url: string
    method: string
    // ...
  }
}

// MCP 工具执行器
interface McpActionConfig {
  type: "mcp"
  config: {
    toolName: string
    args: Record<string, any>
  }
}
```

### 12.3 Skills 集成

```typescript
// 在 AI 处理时注入 skills
// 参考 src/main/lib/trpc/routers/skills.ts
```

### 12.4 markRead 功能

```typescript
// 需要在 automation_executions 或 chats 表添加 isRead 字段
// 更新 tRPC 路由添加 markInboxItemRead 方法
```

## 13. 测试方法

### 13.1 手动测试

```typescript
// 1. 创建测试自动化
const auto = await trpc.automations.create.mutate({
  name: "测试",
  triggers: [{ type: "cron", config: { expression: "* * * * *", strict: false } }],
  agentPrompt: "Say hello",
  actions: [{ type: "inbox", config: {} }]
})

// 2. 手动触发
await trpc.automations.trigger.mutate({ id: auto.id })

// 3. 检查 Inbox
const inbox = await trpc.automations.getInboxChats.query({ limit: 10 })
console.log(inbox.chats)

// 4. 检查执行历史
const execs = await trpc.automations.listExecutions.query({ automationId: auto.id })
console.log(execs)
```

### 13.2 数据库检查

```bash
# 数据库位置
~/Library/Application Support/1code/data/agents.db

# SQLite 命令
sqlite3 ~/Library/Application\ Support/1code/data/agents.db

# 常用查询
.tables
SELECT * FROM automations;
SELECT * FROM automation_executions ORDER BY started_at DESC LIMIT 5;
SELECT * FROM chats WHERE project_id = 'inbox-special-project';
```

## 14. 注意事项

1. **时区**：所有 cron 任务使用 `Asia/Shanghai` 时区
2. **API Key**：没有配置 `ANTHROPIC_API_KEY` 时，AI 处理会返回原始 prompt
3. **错误恢复**：单个自动化执行失败不影响其他自动化
4. **内存泄漏**：应用关闭时必须调用 `cleanup()` 停止所有定时任务
5. **数据库迁移**：使用 `CREATE TABLE IF NOT EXISTS` 确保幂等性

## 15. 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0 | 2026-02-04 | 初始实现：Cron 触发器 + Inbox 执行器 |
