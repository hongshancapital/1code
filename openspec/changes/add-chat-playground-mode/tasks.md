# Tasks: Chat Playground Mode

## 1. Backend - Playground 项目管理

- [ ] 1.1 在 projects router 中添加 `createPlaygroundProject` 方法
  - 在 `~/.hong/.playground/{nanoid}/` 创建目录
  - 创建 isPlayground: true 的 project 记录
  - 返回 project 信息

- [ ] 1.2 在 projects router 中添加 `migratePlaygroundProject` 方法
  - 接收 projectId 和 targetPath
  - 验证目标路径不存在或为空目录
  - 移动目录内容到目标路径
  - 更新 project.path 和 project.isPlayground = false
  - 删除原 playground 目录

- [ ] 1.3 在 projects router 中添加 `deletePlaygroundProject` 方法
  - 删除 playground 目录和所有内容
  - 级联删除 project 和关联的 chats

## 2. Backend - Chat 创建流程

- [ ] 2.1 修改 chats router 的 create 方法
  - 新增 `type: "playground" | "workspace"` 参数
  - 当 type 为 "playground" 时，自动调用 createPlaygroundProject
  - 关联到新创建的 playground project

- [ ] 2.2 添加 `getPlaygroundInfo` 方法
  - 返回 playground 目录路径和大小信息
  - 用于 UI 展示

## 3. Sidebar - 分类展示

- [ ] 3.1 添加新的分组模式："type"（按类型分组）
  - 修改 `src/renderer/lib/atoms/grouping.ts`
  - 添加 "type" 选项到 workspaceGroupModeAtom

- [ ] 3.2 修改 GroupedChatList 支持 type 分组
  - Workspaces 组：isPlayground = false 的项目
  - Chats 组：isPlayground = true 的项目

- [ ] 3.3 修改 GroupingToggle 添加 "按类型" 选项

- [ ] 3.4 Chat 项不展示目录路径
  - 检测 isPlayground，隐藏路径信息

## 4. UI - 创建入口

- [ ] 4.1 添加快速创建 Chat 的入口
  - 侧边栏底部或顶部添加 "+ New Chat" 按钮
  - 点击后直接创建 playground chat 并打开

## 5. UI - 迁移功能

- [ ] 5.1 创建 MoveToWorkspaceDialog 组件
  - 路径选择器（支持系统目录选择对话框）
  - 新目录名输入
  - 预览目标路径
  - 确认/取消按钮

- [ ] 5.2 在 Chat 详情或右键菜单添加 "Move to Workspace" 选项
  - 仅对 playground chat 显示

- [ ] 5.3 迁移成功后的处理
  - 更新 UI 状态
  - 显示成功提示
  - 自动切换到 Workspaces 分类

## 6. 清理和优化

- [ ] 6.1 应用启动时清理空的 playground 目录
  - 检查 ~/.hong/.playground/ 下的孤儿目录
  - 删除没有关联 project 的目录

- [ ] 6.2 添加 playground 存储大小显示
  - 在设置或 Chat 详情中显示占用空间

## 7. 测试

- [ ] 7.1 测试创建 playground chat 流程
- [ ] 7.2 测试在 playground 中读写文件
- [ ] 7.3 测试迁移到正式目录
- [ ] 7.4 测试删除 playground chat
