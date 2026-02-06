## ADDED Requirements

### Requirement: Playground Project Creation
系统 SHALL 支持创建 Playground 项目，用于零配置的临时聊天空间。

#### Scenario: 创建 Playground 项目
- **WHEN** 用户创建新的 Chat（非指定目录）
- **THEN** 系统在 `~/.hong/.playground/{nanoid}/` 自动创建目录
- **AND** 创建 isPlayground: true 的 project 记录
- **AND** 创建关联的 chat 记录

#### Scenario: Playground 目录结构
- **GIVEN** playground 根目录为 `~/.hong/.playground/`
- **WHEN** 创建新的 playground 项目
- **THEN** 使用 nanoid 生成唯一目录名
- **AND** 目录结构为 `~/.hong/.playground/{nanoid}/`

### Requirement: Playground Chat Full Cowork Capability
Playground Chat SHALL 拥有与普通 Workspace 相同的完整读写能力。

#### Scenario: 在 Playground 中创建文件
- **WHEN** 用户在 Playground Chat 中请求创建文件
- **THEN** 系统在 playground 目录下创建文件
- **AND** 文件操作与普通 Workspace 相同

#### Scenario: 在 Playground 中运行代码
- **WHEN** 用户在 Playground Chat 中请求运行代码
- **THEN** 系统使用 playground 目录作为工作目录
- **AND** 执行结果与普通 Workspace 相同

### Requirement: Sidebar Type Grouping
侧边栏 SHALL 支持按类型分组，区分 Workspaces 和 Chats。

#### Scenario: 按类型分组展示
- **WHEN** 用户选择 "按类型" 分组模式
- **THEN** 侧边栏显示两个分组：
  - "Workspaces"：isPlayground = false 的项目
  - "Chats"：isPlayground = true 的项目

#### Scenario: Chat 不显示目录路径
- **GIVEN** 一个 isPlayground = true 的项目
- **WHEN** 在侧边栏展示该项目的 Chat
- **THEN** 不显示目录路径
- **AND** 只显示 Chat 名称

### Requirement: Playground Migration to Workspace
系统 SHALL 支持将 Playground 目录迁移为正式 Workspace。

#### Scenario: 迁移 Playground 到指定路径
- **GIVEN** 一个 isPlayground = true 的项目
- **WHEN** 用户选择 "Move to Workspace" 并指定目标路径
- **THEN** 系统将 playground 目录内容移动到目标路径
- **AND** 更新 project.path 为新路径
- **AND** 设置 project.isPlayground = false
- **AND** 删除原 playground 目录

#### Scenario: 迁移目标路径验证
- **WHEN** 用户指定迁移目标路径
- **THEN** 系统验证：
  - 目标路径不存在，或
  - 目标路径为空目录
- **AND** 如果验证失败，显示错误信息

#### Scenario: 迁移后 UI 更新
- **WHEN** 迁移成功完成
- **THEN** Chat 从 "Chats" 分组移动到 "Workspaces" 分组
- **AND** 显示成功提示

### Requirement: Playground Cleanup
系统 SHALL 清理孤儿 Playground 目录。

#### Scenario: 启动时清理孤儿目录
- **WHEN** 应用启动
- **THEN** 检查 `~/.hong/.playground/` 下的目录
- **AND** 删除没有关联 project 记录的目录
