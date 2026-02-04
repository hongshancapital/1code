# 自动化引擎快速入门

## 🚀 5 分钟快速开始

### 1. 安装依赖（已完成）

```bash
✅ yarn add node-cron @anthropic-ai/sdk
✅ yarn add -D @types/node-cron
```

### 2. 配置环境变量

编辑 `.env` 文件：

```bash
# 添加你的 Anthropic API Key
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
```

### 3. 启动应用

```bash
yarn dev:hot
```

应用启动时会自动：
- ✅ 运行数据库迁移
- ✅ 创建 Inbox 项目
- ✅ 初始化自动化引擎
- ✅ 注册所有定时任务

### 4. 验证安装

```bash
node test-automation.js
```

看到以下输出表示成功：
```
✅ 自动化表已存在
✅ Inbox 项目已存在
✅ 测试自动化已创建
```

## 📝 创建你的第一个自动化

### 使用 tRPC 客户端（推荐）

在 Hong 渲染进程中：

```typescript
import { trpc } from '@/lib/trpc'

// 创建自动化
const automation = await trpc.automations.create.mutate({
  name: "每日早报",
  description: "每天早上9点发送新闻摘要",
  triggers: [
    {
      type: "cron",
      config: {
        expression: "0 9 * * *",  // 每天 9:00
        strict: false             // 允许启动补偿
      }
    }
  ],
  agentPrompt: "请生成今日科技新闻摘要（3-5条）",
  actions: [
    { type: "inbox", config: {} }
  ]
})

// 手动触发测试
await trpc.automations.trigger.mutate({ id: automation.id })

// 查看 Inbox
const inbox = await trpc.automations.getInboxChats.query({ limit: 50 })
console.log("Inbox 消息数:", inbox.chats.length)
```

### 使用 SQL（用于测试）

```sql
-- 创建自动化
INSERT INTO automations (
  id, name, description, is_enabled,
  triggers, agent_prompt, actions,
  created_at, updated_at,
  total_executions, successful_executions, failed_executions
) VALUES (
  'daily-news',
  '每日早报',
  '每天早上9点发送新闻摘要',
  1,
  '[{"type":"cron","config":{"expression":"0 9 * * *","strict":false}}]',
  '请生成今日科技新闻摘要（3-5条）',
  '[{"type":"inbox","config":{}}]',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000,
  0, 0, 0
);

-- 查看所有自动化
SELECT id, name, is_enabled, total_executions FROM automations;

-- 查看执行历史
SELECT
  ae.status, ae.triggered_by, ae.started_at,
  a.name as automation_name
FROM automation_executions ae
JOIN automations a ON ae.automation_id = a.id
ORDER BY ae.started_at DESC
LIMIT 10;

-- 查看 Inbox 消息
SELECT id, name, created_at
FROM chats
WHERE project_id = 'inbox-special-project'
ORDER BY created_at DESC;
```

## 🎯 常见应用场景

### 场景 1: 每日站会提醒

```typescript
{
  name: "站会提醒",
  triggers: [{
    type: "cron",
    config: {
      expression: "30 9 * * 1-5",  // 工作日 9:30
      strict: false
    }
  }],
  agentPrompt: "生成站会提醒：请大家分享今日计划和昨日进展",
  actions: [{ type: "inbox", config: {} }]
}
```

### 场景 2: 代码审查提醒

```typescript
{
  name: "Code Review 提醒",
  triggers: [{
    type: "cron",
    config: {
      expression: "0 15 * * 1-5",  // 工作日下午3点
      strict: false
    }
  }],
  agentPrompt: "提醒团队：请审查待处理的 Pull Requests",
  actions: [{ type: "inbox", config: {} }]
}
```

### 场景 3: 周报生成

```typescript
{
  name: "周报生成",
  triggers: [{
    type: "cron",
    config: {
      expression: "0 17 * * 5",  // 每周五下午5点
      strict: false
    }
  }],
  agentPrompt: "生成本周工作总结模板，包含：完成项目、进行中项目、下周计划",
  actions: [{ type: "inbox", config: {} }]
}
```

## 🔧 调试技巧

### 查看日志

启动应用时查看控制台：

```bash
# 自动化引擎初始化
[Hong Loader] Automation engine initialized

# 定时任务触发
[Scheduler] Cron triggered: automation_id

# 执行成功
[AutomationEngine] Execution completed: execution_id
```

### 检查数据库

```bash
# macOS
sqlite3 ~/Library/Application\ Support/Tinker/data/agents.db

# 常用查询
.tables                           # 查看所有表
.schema automations               # 查看表结构
SELECT * FROM automations;        # 查看所有自动化
SELECT * FROM automation_executions ORDER BY started_at DESC LIMIT 5;
```

### 手动触发任务

```typescript
// 通过 tRPC
await trpc.automations.trigger.mutate({ id: "automation_id" })

// 或通过 SQL 重置触发时间
UPDATE automations
SET last_triggered_at = NULL
WHERE id = 'automation_id';
```

## 📊 监控和统计

### 查看执行统计

```typescript
const automations = await trpc.automations.list.query()

automations.forEach(auto => {
  console.log(`${auto.name}:`)
  console.log(`  总执行: ${auto.totalExecutions}`)
  console.log(`  成功: ${auto.successfulExecutions}`)
  console.log(`  失败: ${auto.failedExecutions}`)
  console.log(`  成功率: ${(auto.successfulExecutions / auto.totalExecutions * 100).toFixed(1)}%`)
})
```

### 查看执行历史

```typescript
const history = await trpc.automations.listExecutions.query({
  automationId: "automation_id",  // 可选
  limit: 20
})

history.forEach(exec => {
  console.log(`${exec.triggeredBy} - ${exec.status} - ${exec.durationMs}ms`)
  if (exec.errorMessage) {
    console.error(`  Error: ${exec.errorMessage}`)
  }
})
```

## 🎨 Cron 表达式速查

| 表达式 | 说明 |
|--------|------|
| `* * * * *` | 每分钟 |
| `0 * * * *` | 每小时开始 |
| `0 9 * * *` | 每天 9:00 |
| `0 9 * * 1` | 每周一 9:00 |
| `0 9 1 * *` | 每月1日 9:00 |
| `0 9 * * 1-5` | 工作日 9:00 |
| `0 9,18 * * *` | 每天 9:00 和 18:00 |
| `*/15 * * * *` | 每15分钟 |
| `0 */2 * * *` | 每2小时 |
| `30 9 * * 1-5` | 工作日 9:30 |

在线工具：https://crontab.guru/

## ⚠️ 注意事项

### API Key 安全

- ❌ 不要将 API key 提交到 Git
- ✅ 使用 `.env` 文件（已在 .gitignore 中）
- ✅ 团队成员各自配置自己的 key

### Token 成本

每次执行会消耗 Claude API tokens：
- 默认 max_tokens: 1024
- 短 prompt 通常消耗 100-500 tokens
- 监控 `automation_executions.input_tokens` 和 `output_tokens`

### 时区设置

所有定时任务使用 `Asia/Shanghai` 时区，在 `scheduler.ts:26` 中配置。

### 严格模式

- `strict: true`: 错过就跳过
- `strict: false`: 启动时补偿执行（推荐）

## 🐛 常见问题

### Q: 定时任务没有执行？

A: 检查清单：
1. 自动化是否启用？(`is_enabled = 1`)
2. Cron 表达式是否正确？
3. 应用是否在运行？
4. 查看日志是否有错误

### Q: Inbox 消息没有出现？

A: 检查：
1. `automation_executions.status` 是否为 `success`
2. `automation_executions.inbox_chat_id` 是否有值
3. `chats` 表中是否有对应记录
4. 前端是否连接了正确的 tRPC API

### Q: API Key 错误？

A:
1. 检查 `.env` 中的 `ANTHROPIC_API_KEY`
2. 确保 key 有效且有配额
3. 重启应用加载新的环境变量

### Q: 如何禁用某个自动化？

A:
```typescript
await trpc.automations.update.mutate({
  id: "automation_id",
  isEnabled: false
})
```

### Q: 如何修改 Cron 表达式？

A:
```typescript
await trpc.automations.update.mutate({
  id: "automation_id",
  triggers: [
    {
      type: "cron",
      config: {
        expression: "0 10 * * *",  // 改为 10:00
        strict: false
      }
    }
  ]
})
```

## 📚 下一步

- 阅读完整文档：[AUTOMATION.md](AUTOMATION.md)
- 查看代码结构：`packages/hong/main/lib/automation/`
- 扩展功能：添加新的触发器或执行器
- 集成 MCP：让自动化调用 MCP 工具

## 🆘 获取帮助

- 查看日志：控制台输出带 `[Scheduler]` 和 `[AutomationEngine]` 前缀
- 检查数据库：`~/Library/Application Support/Tinker/data/agents.db`
- 运行测试：`node test-automation.js`
