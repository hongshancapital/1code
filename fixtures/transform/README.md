# Transform Test Fixtures

此目录存放录制的 SDK 消息流，用于验证重构后的 transform 实现。

## 录制方法

在 `src/main/lib/trpc/routers/claude.ts` 中添加消息录制逻辑：

```typescript
const allMessages: any[] = [];

const messageStream = await claudeEngine.query(/* ... */);

for await (const msg of messageStream) {
  allMessages.push(msg); // 录制消息

  // 现有的 transform 逻辑...
  const chunks = transform(msg);
  for (const chunk of chunks) {
    emit.chunk(chunk);
  }
}

// 会话结束后保存
fs.writeFileSync(
  `fixtures/transform/${Date.now()}-${scenario}.json`,
  JSON.stringify(allMessages, null, 2)
);
```

## 测试场景

建议录制以下场景：

1. **bash-background-task.json** - Bash 工具后台任务
   - 用户请求：`bun run build` (with run_in_background)
   - 包含 backgroundTaskId 检测

2. **nested-tool-calls.json** - 嵌套工具调用（Explore agent）
   - 用户请求：让 Explore agent 搜索文件
   - 包含 parent_tool_use_id

3. **extended-thinking.json** - Extended Thinking 模型
   - 使用支持思维流的模型
   - 包含 thinking 块

4. **stream-interruption.json** - 流式中断
   - 网络中断或用户取消
   - 包含不完整 JSON

5. **multiple-tools.json** - 并发多个工具
   - 同时调用 Read + Glob + Grep
   - 测试去重逻辑

## 运行验证

```bash
bun run scripts/verify-transform-refactor.ts
```

## 预期结果

所有场景应输出：
```
✅ 输出一致
```

如果出现差异，检查：
1. Chunk 类型是否匹配
2. Chunk 顺序是否一致
3. 数据内容是否相同（允许 ID 差异）
