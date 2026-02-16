# Bug 修复：新建 subchat 显示旧消息

## 问题

在 subchat sidebar 中点击"+"创建新 subchat 时，新 tab 的消息区域显示了上一个 subchat 的消息内容，而不是空白。

## 根因

文件：`src/renderer/features/agents/main/active-chat.tsx`

`getOrCreateChat` 函数（第 2582-2583 行）在为**新创建的 subchat** 创建 Chat 对象时，使用了 `subChatMessagesData?.parsedMessages` 作为初始消息。

问题在于 React Query 配置了 `placeholderData: (prev) => prev`（第 2006 行）。当 `activeSubChatId` 切换到新 subchat 时，React Query 发起新查询（`{ id: newSubChatId }`），但在新查询返回前，`subChatMessagesData` **仍然是旧 subchat 的消息数据**（占位数据）。

`getOrCreateChat` 的条件检查 `subChatMessagesData?.parsedMessages && subChatId === activeSubChatId` 在此时为 true（两者都是新 ID），所以**旧消息被错误地用于初始化新 Chat 对象**。

触发路径：`agents-subchats-sidebar.tsx` 的 `handleCreateNew` 不主动创建 Chat 对象，依赖 `getOrCreateChat` 延迟创建 → `getOrCreateChat` 用 placeholderData 中的旧消息创建了 Chat。

## 修复方案

从 `useQuery` 解构 `isPlaceholderData`，在 `getOrCreateChat` 使用 `subChatMessagesData` 之前增加 `!isPlaceholderData` 检查。

### 改动点

**文件：`src/renderer/features/agents/main/active-chat.tsx`**

1. **第 1999 行**：从 `useQuery` 结果中解构 `isPlaceholderData`
   ```typescript
   // 改前
   const { data: subChatMessagesData, isLoading: isLoadingMessages } =
   // 改后
   const { data: subChatMessagesData, isLoading: isLoadingMessages, isPlaceholderData } =
   ```

2. **第 2549 行和第 2583 行**：在条件中增加 `!isPlaceholderData` 检查
   ```typescript
   // 改前 (第 2549 行)
   const hasNewMessages = subChatMessagesData?.parsedMessages && subChatId === activeSubChatId;
   // 改后
   const hasNewMessages = subChatMessagesData?.parsedMessages && subChatId === activeSubChatId && !isPlaceholderData;

   // 改前 (第 2583 行)
   if (subChatMessagesData?.parsedMessages && subChatId === activeSubChatId) {
   // 改后
   if (subChatMessagesData?.parsedMessages && subChatId === activeSubChatId && !isPlaceholderData) {
   ```

3. **`getOrCreateChat` 依赖列表**：增加 `isPlaceholderData`
