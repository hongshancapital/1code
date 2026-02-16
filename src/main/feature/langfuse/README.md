# Langfuse Extension

将 Claude 会话追踪到 Langfuse（LLM 可观测性平台），监控 token 使用、成本、工具调用等。

## 功能

- **会话追踪** — 每个 Claude 会话创建一个 Trace，包含所有对话轮次
- **AI 输出监控** — 记录 token 使用量、模型名称、输入输出、成本
- **工具调用追踪** — 记录每个工具的输入输出和执行时间
- **非阻塞处理** — 完全异步，不影响 Claude 对话性能
- **错误隔离** — Langfuse 故障不影响主流程

## 配置

在环境变量中设置 Langfuse 凭证：

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-xxx"
export LANGFUSE_SECRET_KEY="sk-lf-xxx"
export LANGFUSE_HOST="https://cloud.langfuse.com"  # 可选，默认为 cloud
```

未配置时，Extension 自动禁用（优雅降级）。

## 数据模型

```
Claude Session → Langfuse Trace (会话级容器)
  ├─ AI 输出 → Generation (含 token 统计、成本)
  └─ 工具调用 → Span (含输入输出)
```

## 文件结构

```
src/main/feature/langfuse/
├── index.ts              # Extension 入口（订阅 hooks）
├── client.ts             # Langfuse SDK 封装
├── config.ts             # 环境变量配置读取
├── hooks.ts              # Hook 处理逻辑
├── types.ts              # TypeScript 类型定义
└── utils.ts              # 工具函数（截断、成本计算等）
```

## 订阅的 Hooks

| Hook | 触发点 | 处理逻辑 |
|------|--------|---------|
| `SessionStart` | 会话创建 | 创建 Trace + 记录初始 prompt |
| `UserPrompt` | 用户输入 | 累积 prompts（多轮对话） |
| `ToolOutput` | 工具完成 | 创建 Span（工具调用） |
| `AssistantMessage` | AI 回复 | 累积 assistant 文本 |
| `StreamComplete` | 流成功 | 创建 Generation（含 token） |
| `StreamError` | 流出错 | 创建 Generation（标记 error） |
| `SessionEnd` | 会话结束 | 完成 Trace |
| `Cleanup` | 资源清理 | 清空 traceMap |

## 验证

1. 配置环境变量（见上方）
2. 启动应用：`bun run dev`
3. 执行一次完整对话（包含工具调用）
4. 登录 Langfuse Dashboard: https://cloud.langfuse.com
5. 验证数据：
   - **Trace** 列表中看到新会话
   - **Generation** 包含 token 统计、模型名、输入输出
   - **Span** 包含工具调用的输入输出
   - 时间戳和持续时间正确

## 成本计算

基于 Anthropic 官方定价（美元/百万 token）：

| 模型 | Input | Output |
|------|-------|--------|
| Claude Opus 4.5 | $15 | $75 |
| Claude Sonnet 4.5 | $3 | $15 |
| Claude Haiku 3.5 | $0.8 | $4 |

成本自动计算并附加到 Generation 的 metadata 中。

## 数据截断

工具输出 >10KB 时自动截断，返回格式：

```json
{
  "_truncated": true,
  "_originalLength": 50000,
  "preview": "前 10KB 内容...[truncated]"
}
```

## 错误处理

- **SDK 初始化失败** → 返回空 cleanup，Extension 不生效
- **Hook 处理错误** → 使用 `.catch()` 捕获并记录，不阻塞主流程
- **数据缺失** → 使用 fallback 值 + 警告日志
- **并发会话** → `traceMap` 按 `subChatId` 隔离

## 开发

```bash
bun add langfuse                     # 安装依赖
bun run build                         # 编译检查
bun run dev                           # 开发模式
```

注册位置：`src/main/index.ts` — `em.register(langfuseExtension)`
