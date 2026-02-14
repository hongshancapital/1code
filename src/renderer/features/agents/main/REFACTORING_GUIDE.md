# Active Chat 重构指南

本文档描述如何使用新创建的 Context 和 Hooks 来重构 `active-chat.tsx`。

## 新架构概览

### Context 层次结构

```
App
└── PlatformProvider (全局)
    └── ChatInstanceProvider (per chatId)
        └── ProjectModeProvider
            └── ChatCapabilitiesProvider
                └── SubChatProvider (per subChatId)
                    └── MessageSendProvider
                        └── [UI Components]
```

### 可用的 Context 和 Hooks

#### 1. PlatformContext (全局)

替换所有 `isDesktopApp()` 调用：

```tsx
// Before
import { isDesktopApp } from "../../../lib/utils/platform"
const isDesktop = isDesktopApp()

// After
import { usePlatform } from "../../../contexts/PlatformContext"
const { isDesktop, isMacOS, modKey } = usePlatform()
```

#### 2. ChatCapabilitiesContext

替换 hideGitFeatures 和 canOpenXxx 逻辑：

```tsx
// Before
const canOpenDiff = !!worktreePath || (!!sandboxId && !isDesktopApp())
const hideGitFeatures = hideGitFeaturesFromProps

// After
import { useChatCapabilities } from "../context"
const {
  hideGitFeatures,
  canOpenDiff,
  canOpenTerminal,
  canOpenPreview,
} = useChatCapabilities()
```

#### 3. usePrOperations Hook

替换 PR 相关操作：

```tsx
// Before (in active-chat.tsx, ~200 lines)
const [isCreatingPr, setIsCreatingPr] = useState(false)
const handleCreatePr = useCallback(async () => { ... }, [])
const handleCommitToPr = useCallback(async () => { ... }, [])
// ...等等

// After
import { usePrOperations } from "../hooks"
const {
  handleCreatePr,
  handleCreatePrDirect,
  handleCommitToPr,
  handleMergePr,
  handleReview,
  isCreatingPr,
  isMergingPr,
  prState,
} = usePrOperations()
```

#### 4. useChatKeyboardShortcuts Hook

替换键盘快捷键 useEffect 块：

```tsx
// Before (5 个 useEffect 块, ~200 lines)
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const isDesktop = isDesktopApp()
    if (isDesktop && e.metaKey && e.code === "KeyT" && !e.altKey) { ... }
  }
  window.addEventListener("keydown", handleKeyDown)
  return () => window.removeEventListener("keydown", handleKeyDown)
}, [handleCreateNewSubChat])

// After
import { useChatKeyboardShortcuts } from "../hooks"
useChatKeyboardShortcuts({
  chatId,
  onNewSubChat: handleCreateNewSubChat,
  onToggleDiffSidebar: () => setIsDiffSidebarOpen(prev => !prev),
  onRestoreWorkspace: handleRestoreWorkspace,
  isDiffSidebarOpen,
  isArchived,
  isRestoringWorkspace: restoreWorkspaceMutation.isPending,
  isSubChatMultiSelectMode,
  selectedSubChatIds,
  clearSubChatSelection,
})
```

#### 5. PanelGate 组件

根据能力条件渲染 Sidebar：

```tsx
// Before
{!hideGitFeatures && isDiffSidebarOpen && (
  <DiffSidebar ... />
)}

// After
import { PanelGate, PANEL_IDS } from "../ui/panel-system"
<PanelGate panelId={PANEL_IDS.DIFF}>
  {isDiffSidebarOpen && <DiffSidebar ... />}
</PanelGate>
```

## 迁移步骤

### 第一步：添加 Provider 包装

在 `ChatView` 组件的 return 语句最外层添加 Provider：

```tsx
return (
  <ChatInstanceProvider chatId={chatId}>
    <ProjectModeProvider>
      <ChatCapabilitiesProvider hideGitFeaturesFromProps={hideGitFeatures}>
        {/* 原有的 JSX */}
      </ChatCapabilitiesProvider>
    </ProjectModeProvider>
  </ChatInstanceProvider>
)
```

### 第二步：替换内部逻辑

1. 将 `isDesktopApp()` 调用替换为 `usePlatform()` 返回值
2. 将 PR 操作逻辑替换为 `usePrOperations()`
3. 将键盘快捷键 useEffect 替换为 `useChatKeyboardShortcuts()`
4. 使用 `PanelGate` 包装条件渲染的 sidebar

### 第三步：提取子组件

将大型内联组件提取到独立文件：

- `ChatHeader` - 头部控制区
- `SubChatTabs` - 子聊天标签页
- `ChatViewLayout` - 整体布局（已创建）

## 文件位置

- Context: `src/renderer/features/agents/context/`
- Hooks: `src/renderer/features/agents/hooks/`
- Panel System: `src/renderer/features/agents/ui/panel-system/`
- Layout: `src/renderer/features/agents/main/chat-view-layout.tsx`

## 注意事项

1. 保持向后兼容：新 Context 都提供 `*Safe` 版本的 hook，返回 null 而非抛错
2. 渐进式迁移：可以逐个替换，不需要一次性完成
3. 测试验证：每次修改后运行 `bun run build` 确认构建通过
