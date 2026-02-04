# 自动化引擎使用文档

## 概述

Hong 模块集成了一个智能自动化引擎，支持定时任务、AI 处理和 Inbox 消息创建。

## 功能特性

### ✅ 已实现
- **定时任务触发器**：支持 cron 表达式定时执行
- **AI 处理**：通过 Claude API 智能处理任务
- **Inbox 消息执行器**：将结果发送到 Inbox
- **启动补偿**：应用重启时检查错过的非严格任务
- **执行历史**：完整的执行记录和统计

### 🚧 待实现
- Webhook 触发器
- API 调用执行器
- 文件操作执行器
- MCP 工具集成

## 快速开始

### 1. 配置 API Key

复制 `.env.example` 到 `.env` 并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，添加 Anthropic API Key：

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### 2. 启动应用

```bash
yarn dev:hot
```

应用启动时会：
1. 自动运行数据库迁移，创建 `automations` 和 `automation_executions` 表
2. 创建特殊的 Inbox 项目（ID: `inbox-special-project`）
3. 初始化自动化引擎
4. 检查并注册所有启用的定时任务
5. 补偿执行错过的非严格任务

### 3. 测试基本功能

运行测试脚本：

```bash
node test-automation.js
```

这将：
- 检查数据库表结构
- 创建测试自动化任务
- 显示现有的自动化和执行历史

## tRPC API 使用

### 创建自动化

```typescript
import { trpc } from '@/lib/trpc'

const result = await trpc.automations.create.mutate({
  name: "每日早报",
  description: "每天早上9点发送新闻摘要",
  triggers: [
    {
      type: "cron",
      config: {
        expression: "0 9 * * *", // 每天 9:00
        strict: false           // 非严格模式，启动时可补偿
      }
    }
  ],
  agentPrompt: "请生成今日科技新闻摘要（3-5条）",
  actions: [
    {
      type: "inbox",
      config: {}
    }
  ]
})
```

### 列出所有自动化

```typescript
const automations = await trpc.automations.list.query()
```

### 手动触发

```typescript
await trpc.automations.trigger.mutate({ id: "automation_id" })
```

### 查看 Inbox 消息

```typescript
const inbox = await trpc.automations.getInboxChats.query({ limit: 50 })
```

### 查看执行历史

```typescript
const executions = await trpc.automations.listExecutions.query({
  automationId: "automation_id", // 可选，筛选特定自动化
  limit: 20
})
```

### 更新自动化

```typescript
await trpc.automations.update.mutate({
  id: "automation_id",
  isEnabled: false, // 禁用
  // 或修改其他字段
})
```

### 删除自动化

```typescript
await trpc.automations.delete.mutate({ id: "automation_id" })
```

## Cron 表达式示例

```bash
# 每分钟
* * * * *

# 每天早上 9:00
0 9 * * *

# 每周一早上 9:00
0 9 * * 1

# 每月1号早上 9:00
0 9 1 * *

# 每小时的第30分钟
30 * * * *

# 每天中午 12:00 和晚上 6:00
0 12,18 * * *
```

格式：`分钟 小时 日期 月份 星期`

## 数据库结构

### automations 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | TEXT | 主键 |
| name | TEXT | 自动化名称 |
| description | TEXT | 描述 |
| is_enabled | INTEGER | 是否启用 |
| triggers | TEXT | 触发器配置 (JSON) |
| agent_prompt | TEXT | AI 处理的 Prompt |
| skills | TEXT | 技能列表 (JSON，待实现) |
| model_id | TEXT | Claude 模型 ID |
| actions | TEXT | 执行器配置 (JSON) |
| project_id | TEXT | 关联项目 (可选) |
| last_triggered_at | INTEGER | 最后触发时间 |
| total_executions | INTEGER | 总执行次数 |
| successful_executions | INTEGER | 成功次数 |
| failed_executions | INTEGER | 失败次数 |

### automation_executions 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | TEXT | 主键 |
| automation_id | TEXT | 关联的自动化 ID |
| status | TEXT | 状态 (running/success/failed) |
| triggered_by | TEXT | 触发方式 (cron/manual/startup-missed) |
| trigger_data | TEXT | 触发数据 (JSON) |
| result | TEXT | 执行结果 (JSON) |
| error_message | TEXT | 错误信息 |
| inbox_chat_id | TEXT | 关联的 Inbox Chat ID |
| started_at | INTEGER | 开始时间 |
| completed_at | INTEGER | 完成时间 |
| duration_ms | INTEGER | 执行耗时（毫秒）|
| input_tokens | INTEGER | 输入 Token 数 |
| output_tokens | INTEGER | 输出 Token 数 |

## 架构设计

```
触发器 (Triggers)
  ├─ Cron (已实现)
  ├─ Webhook (待实现)
  ├─ API (待实现)
  └─ Signal (待实现)
          ↓
AI 处理层 (Claude API)
  ├─ Prompt
  └─ Skills (待实现)
          ↓
执行器 (Actions)
  ├─ Inbox 消息 (已实现)
  ├─ API 调用 (待实现)
  ├─ 文件操作 (待实现)
  ├─ MCP 工具 (待实现)
  └─ HTTP 请求 (待实现)
```

## 代码结构

```
packages/hong/main/lib/
├── automation/
│   ├── types.ts           # TypeScript 类型定义
│   ├── inbox-project.ts   # Inbox 项目初始化
│   ├── scheduler.ts       # 定时任务调度器
│   └── engine.ts          # 自动化引擎核心
├── db/
│   └── schema/
│       └── index.ts       # 数据库 Schema（包含 automations 表）
└── trpc/
    └── routers/
        └── automations.ts # tRPC API 路由
```

## 注意事项

### 严格模式 vs 非严格模式

- **严格模式** (`strict: true`)：定时任务必须精确执行，错过就跳过
- **非严格模式** (`strict: false`)：应用重启时会补偿执行错过的任务

示例：每天 9:00 的任务
- 严格模式：如果 9:00 时应用未运行，则跳过
- 非严格模式：10:00 启动应用时，会立即执行昨天的任务

### 时区

所有定时任务使用 `Asia/Shanghai` 时区。

### Token 消耗

每次 AI 处理会消耗 Claude API token，建议：
- 设置合理的 `max_tokens` 限制（默认 1024）
- 使用较小的模型进行测试
- 监控 `automation_executions` 表中的 token 使用量

### 错误处理

执行失败时：
- 不会影响其他自动化任务
- 错误信息记录在 `automation_executions.error_message`
- 失败统计会更新到 `automations.failed_executions`

## 故障排查

### 自动化没有执行

1. 检查 `is_enabled` 是否为 true
2. 检查 cron 表达式是否正确
3. 查看应用日志中的 `[Scheduler]` 和 `[AutomationEngine]` 输出
4. 检查 `automation_executions` 表中是否有执行记录

### Inbox 消息没有出现

1. 检查 `automation_executions.inbox_chat_id` 是否有值
2. 检查 `chats` 表中是否有记录
3. 验证 `project_id` 是否为 `inbox-special-project`

### API Key 错误

如果看到 Anthropic API 错误：
1. 检查 `.env` 文件中的 `ANTHROPIC_API_KEY`
2. 确保 API key 有效且有足够的配额
3. 重启应用以加载新的环境变量

## 扩展开发

### 添加新的触发器类型

1. 在 `types.ts` 中添加类型定义
2. 在 `scheduler.ts` 或新建服务中实现逻辑
3. 在 `engine.ts` 的 `registerTriggers` 中注册

### 添加新的执行器类型

1. 在 `types.ts` 中添加类型定义
2. 在 `engine.ts` 的 `executeActions` 中添加处理逻辑
3. 可选：拆分到独立的 executor 文件

### 集成 MCP 工具

参考 `builtin-mcp.ts` 的实现，在自动化中调用 MCP 工具：

```typescript
// 在 engine.ts 中添加
import { mcpManager } from "../mcp/manager"

// 在 executeActions 中
if (action.type === "mcp") {
  const result = await mcpManager.callTool(
    action.config.toolName,
    action.config.args
  )
  results.push(result)
}
```

## 版本历史

- **v0.1.0** (2026-02-03)
  - 初始版本
  - 支持 Cron 触发器
  - 支持 Inbox 消息执行器
  - 支持启动补偿执行

## 许可证

GPL-3.0
