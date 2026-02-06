# Runtime Detection Test Plan

## 测试环境

### Windows 10/11
- [ ] 有 Python 环境（检查 `python` 命令）
- [ ] 无 Python 环境
- [ ] 有 Node.js
- [ ] 有 Git
- [ ] 有 winget
- [ ] 无 winget

### macOS (回归测试)
- [ ] 所有工具检测正常
- [ ] 安装命令正确

### Linux (回归测试)
- [ ] 所有工具检测正常
- [ ] 包管理器检测正确

## 核心改进验证

### 1. Windows 命令别名
```bash
# 测试 python3 -> python 映射
where python
python --version

# 测试 pip3 -> pip 映射
where pip
pip --version
```

### 2. PowerShell 执行
- [ ] PowerShell 命令执行成功
- [ ] PATH 环境变量正确解析
- [ ] 输出格式正确

### 3. 错误信息过滤
- [ ] 不再显示 "is not recognized" 等错误
- [ ] 未安装的工具显示 "Not Installed" 状态
- [ ] version 字段为 null（不是错误消息）

### 4. 超时处理
- [ ] 10 秒超时足够完成检测
- [ ] 超时不会导致 UI 卡死
- [ ] 缓存机制正常工作

## 预期结果

### Windows 环境下应该看到:

1. **Package Manager**
   - ✅ Windows Package Manager (winget) v1.x.x
   - 路径: C:\Program Files\WindowsApps\...

2. **Common Tools**
   - ✅ Git v2.x.x (如果已安装)
   - ❌ ripgrep (Not Installed) - 显示安装按钮
   - ❌ jq (Not Installed) - 显示安装按钮
   - ✅ curl v8.x.x (Windows 10/11 自带)

3. **JavaScript**
   - ✅ Bun v1.x.x (如果已安装)
   - ✅ Node.js v20.x.x (如果已安装)

4. **Python**
   - ✅ Python v3.12.x (如果已安装，通过 `python` 命令检测到)
   - ❌ uv (Not Installed)
   - ✅ pip v24.x (如果 Python 已安装)

5. **Go**
   - ✅ Go v1.22.x (如果已安装)
   - 或 ❌ Go (Not Installed) - 显示下载链接

6. **Rust**
   - ✅ Rust v1.77.x (如果已安装，通过 rustc 检测到)
   - ✅ Cargo v1.77.x (如果已安装)

### 不应该看到的:

- ❌ 绿色标签显示错误消息（如 "'python3' is not recognized..."）
- ❌ 版本号显示为完整错误输出
- ❌ 路径显示为空或错误消息

## 常见问题诊断

### 问题 1: 所有工具显示 "Not Installed"
**原因**: PowerShell 执行策略限制
**解决**:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 问题 2: Python 检测失败但已安装
**原因**:
- Python 未添加到 PATH
- 安装时未勾选 "Add Python to PATH"

**解决**:
1. 重新安装 Python，勾选 "Add to PATH"
2. 或手动添加到系统环境变量

### 问题 3: winget 检测失败
**原因**:
- Windows 版本过旧（需要 Windows 10 1809+）
- App Installer 未安装

**解决**:
通过 Microsoft Store 安装 "App Installer"

## 成功标准

- [x] 所有已安装的工具正确显示版本号
- [x] 未安装的工具显示 "Not Installed" 状态
- [x] 不显示任何错误消息（命令不存在等）
- [x] 安装命令可以复制并成功执行
- [x] 检测速度合理（<30秒）
- [x] macOS 和 Linux 功能不受影响
