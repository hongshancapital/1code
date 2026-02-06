# Windows 包管理器 Provider 系统集成完成

## 概述

成功实现了 Windows 包管理器的 provider 模式，支持 winget 和 Chocolatey 两个包管理器，并提供了自动回退机制。

## 架构设计

### 1. Provider 接口 (`WindowsPackageManager`)

定义了包管理器的标准接口：

```typescript
export interface WindowsPackageManager {
  name: string              // 内部名称 (winget, choco)
  displayName: string       // 显示名称
  priority: number          // 优先级 (数字越大越优先)

  isAvailable(): Promise<boolean>
  install(): Promise<ExecResult>
  installTool(packageId: string, options?: InstallOptions): Promise<ExecResult>
  getInstallCommand(packageId: string, options?: InstallOptions): string
}
```

### 2. Provider 实现

#### WingetProvider (优先级: 100)
- 使用 `winget` 命令
- 支持静默安装：`--silent --accept-package-agreements --accept-source-agreements`
- 自动从 GitHub 下载安装（如果系统未预装）

#### ChocolateyProvider (优先级: 80)
- 使用 `choco` 命令
- 支持静默安装：`-y --no-progress`
- 通过 PowerShell 脚本安装

### 3. Registry 管理器 (`WindowsPackageManagerRegistry`)

提供统一的包管理器访问接口：

```typescript
class WindowsPackageManagerRegistry {
  // 获取可用的包管理器（按优先级排序）
  async getAvailableProvider(): Promise<WindowsPackageManager | null>

  // 安装工具（自动回退到次优先级包管理器）
  async installTool(packageId: string, options: InstallOptions): Promise<Result>

  // 确保至少有一个包管理器可用
  async ensurePackageManager(): Promise<Result>
}
```

### 4. 自动回退机制

安装工具时的执行流程：

```
1. 尝试 winget (优先级 100)
   ├─ 成功 → 返回结果
   └─ 失败 → 继续

2. 尝试 Chocolatey (优先级 80)
   ├─ 成功 → 返回结果
   └─ 失败 → 返回错误
```

## 工具定义扩展

### 新增 `windowsPackageIds` 字段

为每个工具添加了 Windows 包管理器的包 ID 映射：

```typescript
{
  name: "git",
  displayName: "Git",
  installCommands: {
    win32: "winget install Git.Git --silent ...",
  },
  windowsPackageIds: {
    winget: "Git.Git",      // winget 包 ID
    choco: "git",           // Chocolatey 包 ID
  },
}
```

### 已添加包 ID 的工具

| 工具 | winget ID | Chocolatey ID |
|------|-----------|---------------|
| Git | `Git.Git` | `git` |
| ripgrep | `BurntSushi.ripgrep.MSVC` | `ripgrep` |
| jq | `jqlang.jq` | `jq` |
| curl | `cURL.cURL` | `curl` |
| Node.js | `OpenJS.NodeJS.LTS` | `nodejs-lts` |
| Python | `Python.Python.3.12` | `python` |

## tRPC 集成

### 1. `installTool` 端点更新

在 Windows 平台上的执行逻辑：

```typescript
if (process.platform === "win32") {
  const toolDef = TOOL_DEFINITIONS.find(t => t.name === toolName)

  if (toolDef?.windowsPackageIds) {
    const registry = getWindowsPackageManagerRegistry()

    // 1. 尝试 winget
    if (toolDef.windowsPackageIds.winget) {
      const result = await registry.installTool(wingetId, options)
      if (result.success) return result
    }

    // 2. 回退到 Chocolatey
    if (toolDef.windowsPackageIds.choco) {
      const result = await registry.installTool(chocoId, options)
      if (result.success) return result
    }
  }
}
```

### 2. `installPackageManager` 端点更新

在 Windows 平台上自动安装包管理器：

```typescript
if (platform === "win32") {
  const registry = getWindowsPackageManagerRegistry()
  const result = await registry.ensurePackageManager()

  // 自动尝试安装 winget，失败则尝试 Chocolatey
  return {
    success: result.success,
    output: `成功安装 ${result.provider}`,
    packageManager: result.provider,
  }
}
```

## 使用示例

### 1. 安装工具（用户视角）

用户点击"安装 Git"按钮：

```
1. 系统检测到 Windows 平台
2. 查找 Git 的包 ID：winget="Git.Git", choco="git"
3. 尝试使用 winget 安装：
   winget install Git.Git --silent --accept-package-agreements --accept-source-agreements
4. 如果 winget 失败，自动回退到 Chocolatey：
   choco install git -y --no-progress
5. 返回安装结果和使用的包管理器
```

### 2. 确保包管理器可用

在 onboarding 过程中：

```
1. 调用 installPackageManager()
2. 检测 winget 是否可用
   ├─ 可用 → 直接返回
   └─ 不可用 → 尝试从 GitHub 安装
3. 如果 winget 安装失败，尝试 Chocolatey
   ├─ 检测是否已安装
   └─ 未安装 → 运行 PowerShell 安装脚本
4. 返回第一个成功安装的包管理器
```

## 技术细节

### 1. 缓存机制

Registry 使用单例模式，支持缓存重置：

```typescript
let registryInstance: WindowsPackageManagerRegistry | null = null

export function getWindowsPackageManagerRegistry(): WindowsPackageManagerRegistry {
  if (!registryInstance) {
    registryInstance = new WindowsPackageManagerRegistry()
  }
  return registryInstance
}

export function resetWindowsPackageManagerRegistry(): void {
  registryInstance = null
}
```

### 2. 错误处理

每个 provider 都实现了完善的错误处理：

```typescript
try {
  const result = await this.execCommand(command)

  if (!result.success) {
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      success: false,
      error: result.error,
    }
  }

  return { ...result, success: true }
} catch (error) {
  return {
    stdout: "",
    stderr: error.message,
    success: false,
    error: "execution_failed",
  }
}
```

### 3. 命令执行

所有命令通过 PowerShell 执行（一致性）：

```typescript
private async execCommand(command: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    exec(command, {
      shell: "powershell.exe",
      timeout: 600000, // 10 分钟超时
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim() || error.message,
          success: false,
          error: "execution_failed",
        })
      } else {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: true,
        })
      }
    })
  })
}
```

## 优势

### 1. 用户体验
- ✅ 完全静默安装，无需用户手动操作
- ✅ 自动回退，提高安装成功率
- ✅ 清晰的错误信息和进度反馈

### 2. 可维护性
- ✅ Provider 模式易于扩展新的包管理器
- ✅ 类型安全，TypeScript 提供完整的类型检查
- ✅ 模块化设计，职责清晰

### 3. 可靠性
- ✅ 多个包管理器备选，降低单点故障
- ✅ 完善的错误处理和超时机制
- ✅ 缓存机制避免重复检测

## 文件清单

### 新增文件
- `src/main/lib/runtime/windows-package-managers.ts` - Windows 包管理器 provider 系统

### 修改文件
- `src/main/lib/runtime/types.ts` - 添加 `WindowsPackageIds` 接口
- `src/main/lib/runtime/tool-definitions.ts` - 为工具添加 `windowsPackageIds` 字段
- `src/main/lib/runtime/index.ts` - 导出 Windows 包管理器相关功能
- `src/main/lib/trpc/routers/runner.ts` - 集成 provider 系统到安装端点

## 测试建议

### 1. 基础功能测试
- [ ] 在全新 Windows 系统上安装 winget
- [ ] 使用 winget 安装工具（Git, Python, Node.js）
- [ ] 在没有 winget 的系统上自动回退到 Chocolatey
- [ ] 使用 Chocolatey 安装工具

### 2. 回退机制测试
- [ ] winget 安装失败时自动尝试 Chocolatey
- [ ] 两个包管理器都安装失败时的错误提示
- [ ] 包管理器不可用时的自动安装

### 3. 边界情况测试
- [ ] 网络断开时的错误处理
- [ ] 权限不足时的错误提示
- [ ] 同时安装多个工具的并发场景

## 下一步计划

1. **添加更多工具的包 ID**
   - Rust/Cargo
   - Go
   - 其他可选工具

2. **增强用户反馈**
   - 显示正在使用的包管理器
   - 显示安装进度
   - 提供重试选项

3. **性能优化**
   - 并行检测多个包管理器
   - 缓存检测结果
   - 预下载常用工具

4. **监控和日志**
   - 记录包管理器使用统计
   - 跟踪安装成功率
   - 收集错误日志用于改进
