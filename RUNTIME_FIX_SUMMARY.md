# Windows Runtime Detection Fix - Summary

## 修复内容

### 1. 核心改进 (src/main/lib/trpc/routers/runner.ts)

#### 1.1 增强的 execWithTimeout 函数
- ✅ **Windows 命令别名支持**: `python3` → `python`, `pip3` → `pip`
- ✅ **使用 PowerShell**: 替代 cmd.exe，更好的 PATH 解析
- ✅ **结构化错误返回**: 区分 `not_found`, `timeout`, `execution_failed`
- ✅ **更长超时**: 5秒 → 10秒
- ✅ **错误模式识别**: 自动识别 "command not found" 等错误

```typescript
// 新增的 Windows 命令别名映射
const WINDOWS_COMMAND_ALIASES: Record<string, string> = {
  python3: "python",
  pip3: "pip",
}

// 新的返回结构
interface ExecResult {
  stdout: string
  stderr: string
  success: boolean
  error?: "not_found" | "timeout" | "execution_failed"
}
```

#### 1.2 改进的工具检测逻辑
- ✅ **错误消息过滤**: 不再将错误信息当作版本号
- ✅ **stderr 支持**: 某些工具（如 npm）将版本输出到 stderr
- ✅ **别名自动应用**: 在 Windows 上自动使用正确的命令名

```typescript
// 错误模式检测
const errorPatterns = [
  "is not recognized",
  "not found",
  "cannot find",
  "no such file",
  "the term",
  "error:",
  "fatal:",
]
```

#### 1.3 优化的版本解析器
- ✅ **Python**: 改进正则匹配 `Python 3.12.0`
- ✅ **pip**: 改进正则匹配 `pip 24.0 from ...`
- ✅ **uv**: 改进正则匹配 `uv 0.5.11`

### 2. 文档改进

#### 2.1 修复计划 (RUNTIME_DETECTION_FIX.md)
- 问题分析
- 解决方案设计
- 实施计划
- 交付标准

#### 2.2 测试计划 (RUNTIME_DETECTION_TEST.md)
- 测试环境
- 验证点
- 预期结果
- 常见问题诊断

## 影响范围

### 直接影响
- ✅ Windows 10/11 用户的 runtime 检测
- ✅ Python/pip 检测（最常见的问题）
- ✅ 所有需要别名的工具

### 间接影响
- ✅ Settings > Runtime 页面显示
- ✅ Onboarding 流程的工具检测
- ✅ 自动化安装流程

### 不影响
- ✅ macOS 功能保持不变
- ✅ Linux 功能保持不变
- ✅ 已有的缓存机制
- ✅ UI 组件逻辑

## 技术细节

### PowerShell vs cmd.exe

**Before (cmd.exe)**:
```typescript
spawn("cmd.exe", ["/c", "python3 --version"])
// ❌ Windows 下 python3 不存在
```

**After (PowerShell)**:
```typescript
spawn("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "python --version"  // ✅ 使用别名映射后的命令
])
```

### 错误识别流程

```
Command Execution
      ↓
  Exit Code + Output
      ↓
  Pattern Matching
      ↓
  ┌─────────────────┐
  │ "not recognized"│ → not_found
  │ "command not found" → not_found
  │ Timeout         │ → timeout
  │ Exit code != 0  │ → execution_failed
  │ Success         │ → success
  └─────────────────┘
```

## 验证步骤

### 1. 本地开发测试
```bash
bun run dev
```

### 2. 检查 Settings > Runtime 页面
- 打开设置
- 切换到 Runtime 标签
- 点击各个分类的 Refresh 按钮
- 验证显示结果

### 3. 验证点
- [ ] 已安装的工具显示正确版本号（不是错误消息）
- [ ] 未安装的工具显示 "Not Installed"
- [ ] 可以复制安装命令
- [ ] 安装按钮可以点击
- [ ] 没有绿色错误消息标签

### 4. Windows 特定测试
```powershell
# 测试 Python 检测
where python
python --version

# 测试 pip 检测
where pip
pip --version

# 测试 PowerShell 执行
powershell -NoProfile -NonInteractive -Command "python --version"
```

## 已知限制

1. **PowerShell 执行策略**: 某些企业环境可能限制 PowerShell 执行
   - 影响: 所有检测失败
   - 解决: 使用 `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

2. **PATH 环境变量**: 用户安装工具后需要重启应用才能检测到
   - 影响: 新安装的工具不显示
   - 解决: 点击 Refresh 按钮或重启应用

3. **缓存机制**: 60秒缓存可能导致短期内看不到变化
   - 影响: 安装后立即刷新可能看不到
   - 解决: 等待 60 秒或清除缓存（通过 Refresh）

## 下一步

### 短期（必须）
- [ ] 在 Windows 10/11 上测试验证
- [ ] 确认 macOS 功能不受影响
- [ ] 确认 Linux 功能不受影响

### 中期（建议）
- [ ] 添加详细日志输出（DEBUG 模式）
- [ ] 提供诊断工具（导出检测日志）
- [ ] 改进错误提示（更友好的用户消息）

### 长期（优化）
- [ ] 支持自定义命令别名
- [ ] 支持多版本检测（nvm, pyenv 等）
- [ ] 提供手动编辑配置功能

## 相关文件

### 修改的文件
- `src/main/lib/trpc/routers/runner.ts` - 核心检测逻辑

### 新增的文件
- `RUNTIME_DETECTION_FIX.md` - 修复计划
- `RUNTIME_DETECTION_TEST.md` - 测试计划
- `RUNTIME_FIX_SUMMARY.md` - 本文档

### 相关文件（未修改）
- `src/renderer/components/dialogs/settings-tabs/agents-runtime-tab.tsx` - UI 组件
- `src/renderer/lib/atoms/runner.ts` - 状态管理

## 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| PowerShell 被禁用 | 高 | 低 | 提供诊断说明 |
| 别名映射不完整 | 中 | 中 | 持续扩展列表 |
| 版本解析失败 | 低 | 中 | 降级到默认解析 |
| 性能问题 | 低 | 低 | 已有缓存机制 |
| 回归问题 (macOS/Linux) | 高 | 极低 | 充分测试 |

## 联系与反馈

如果发现问题，请提供以下信息：
1. Windows 版本
2. PowerShell 版本 (`$PSVersionTable.PSVersion`)
3. 已安装的工具列表
4. Settings > Runtime 页面截图
5. 开发者控制台日志（F12）
