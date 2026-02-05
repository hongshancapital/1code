# Change: Chat Playground Mode（Chat 即 Workspace）

## Why

当前用户使用应用时必须先指定一个项目目录，这提高了入门门槛。用户可能只是想快速聊天或做一个小实验，不需要预先创建目录。

通过让每个 Chat 自动对应一个 playground 目录，用户可以：
- 零配置启动，立即开始聊天
- 在聊天中创建文件、运行代码，享受完整的 cowork 能力
- 有价值的项目可以迁移到正式目录

## What Changes

### 1. Chat 自动创建 Playground 目录
- 新建 Chat 时自动在 `~/.hong/.playground/{random-id}/` 创建目录
- Chat 关联到一个 `isPlayground: true` 的 Project
- Chat 拥有完整的 cowork 读写能力

### 2. 侧边栏分类展示
- 新增分类模式："Workspaces" vs "Chats"
- Workspaces：正常项目目录（isPlayground: false）
- Chats：playground 项目（isPlayground: true）
- 两者使用相同的 UI 展示方式

### 3. Chat 不展示目录名
- Playground 目录名是随机生成的，展示没有意义
- 只显示 Chat 名称

### 4. 目录迁移功能（Chat → Workspace）
- 新增 "Move to Workspace" 功能
- 用户可以输入新路径，将 playground 目录迁移到指定位置
- 迁移后 isPlayground 变为 false，在 Workspaces 分类展示

## Impact

### Affected Code
- `src/main/lib/db/schema/index.ts` - 已有 isPlayground 字段，无需修改
- `src/main/lib/trpc/routers/projects.ts` - 新增创建 playground 项目 API
- `src/main/lib/trpc/routers/chats.ts` - 新增创建 chat 时自动创建 playground
- `src/renderer/features/sidebar/` - 分类展示 UI
- 新增迁移 API 和 UI 组件

### Breaking Changes
无破坏性变更，完全向后兼容
