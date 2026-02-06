# Runtime Detection Fix Plan for Windows

## 问题分析

根据截图，Windows 环境下的 runtime 检测存在严重问题：

1. **所有工具显示 "command not recognized" 错误**
2. **`python3`, `uv`, `go` 等命令在 Windows 下检测失败**
3. **错误信息直接显示在 UI 上，影响用户体验**

## 核心问题

### 1. Windows 命令执行问题
- `where` 命令可能返回多个路径，需要取第一个
- 某些命令在 Windows 下名称不同（如 `python3` vs `python`）
- `cmd.exe /c` 执行命令可能有路径和环境变量问题

### 2. 版本检测问题
- 某些工具在 Windows 下版本标志不同
- 输出格式可能有差异

### 3. UI 显示问题
- 错误信息直接显示，应该隐藏或转换为友好提示
- 没有区分"未安装"和"检测失败"

## 解决方案

### Phase 1: 修复 execWithTimeout (核心)

1. **增强 Windows 命令执行**
   - 使用 `powershell.exe` 代替 `cmd.exe` 以获得更好的兼容性
   - 正确处理 PATH 环境变量
   - 增加命令别名支持（python3 -> python）

2. **改进超时和错误处理**
   - 增加超时时间到 10 秒
   - 区分"命令不存在"和"执行失败"
   - 返回结构化错误信息

3. **Windows 特定优化**
   - 处理 Windows 路径分隔符
   - 正确解析 `where` 命令输出（可能有多行）
   - 处理 `.exe` 后缀

### Phase 2: 工具定义增强

1. **Windows 命令别名**
   - `python3` → `python` on Windows
   - `pip3` → `pip` on Windows

2. **版本检测增强**
   - 为 Windows 提供特定的 versionParser
   - 处理 stderr 输出（某些工具版本信息在 stderr）

3. **更友好的安装命令**
   - 使用 winget 作为主要包管理器
   - 提供官方下载链接作为备选

### Phase 3: UI 改进

1. **错误状态优化**
   - 不显示原始错误信息
   - 显示"未安装"或"检测失败"
   - 提供诊断按钮查看详细信息

2. **检测状态增强**
   - 添加重试机制
   - 显示检测进度
   - 缓存检测结果

## 实施计划

### Step 1: 修复 execWithTimeout 函数
- 文件: `src/main/lib/trpc/routers/runner.ts`
- 变更:
  - 使用 PowerShell 执行命令
  - 增加 Windows 命令别名映射
  - 改进错误分类
  - 返回结构化结果

### Step 2: 增强 TOOL_DEFINITIONS
- 文件: `src/main/lib/trpc/routers/runner.ts`
- 变更:
  - 添加 Windows 特定配置
  - 优化版本解析器
  - 改进安装命令

### Step 3: UI 错误处理
- 文件: `src/renderer/components/dialogs/settings-tabs/agents-runtime-tab.tsx`
- 变更:
  - 隐藏错误详情
  - 优化显示状态
  - 添加诊断功能

## 测试计划

1. Windows 10/11 测试
   - 有 Python 环境
   - 无 Python 环境
   - 有 winget
   - 无 winget

2. 跨平台测试
   - macOS (确保不影响现有功能)
   - Linux (确保不影响现有功能)

## 交付标准

1. ✅ Windows 下所有工具检测正常
2. ✅ 错误信息友好清晰
3. ✅ 安装命令正确有效
4. ✅ 不影响 macOS/Linux 功能
5. ✅ 检测速度合理（<30s）
6. ✅ 缓存机制工作正常
