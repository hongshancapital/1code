# Windows 静默安装方案

## 目标
所有工具都能通过命令行静默自动安装，无需用户手动操作。

## 各工具的静默安装方案

### 1. Windows Package Manager (winget)
**问题**: winget 本身需要从 Microsoft Store 安装
**解决方案**:
- 使用 winget 的独立安装包（GitHub releases）
- 或者：检测到 winget 不存在时，使用 choco 或 scoop 作为备选

```powershell
# 方案1: 从 GitHub 下载最新的 winget 安装包
$url = "https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\winget.msixbundle"
Add-AppxPackage -Path "$env:TEMP\winget.msixbundle"

# 方案2: 使用 Chocolatey 作为备选包管理器
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

### 2. Git
```bash
# 使用 winget
winget install Git.Git --silent --accept-package-agreements --accept-source-agreements

# 或使用直接下载
$url = "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\git-installer.exe"
Start-Process -Wait -FilePath "$env:TEMP\git-installer.exe" -ArgumentList "/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"
```

### 3. Node.js
```bash
# 使用 winget 静默安装
winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements

# 或使用 Chocolatey
choco install nodejs-lts -y
```

### 4. Bun
```powershell
# 使用官方安装脚本（已经是静默的）
powershell -c "irm bun.sh/install.ps1|iex"
```

### 5. Python
```bash
# 使用 winget 静默安装
winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements

# 或使用直接下载
$url = "https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\python-installer.exe"
Start-Process -Wait -FilePath "$env:TEMP\python-installer.exe" -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1"
```

### 6. Rust
```powershell
# 当前方案已经是静默的（使用 -y 参数）
Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile $env:TEMP\rustup-init.exe
Start-Process -Wait -FilePath $env:TEMP\rustup-init.exe -ArgumentList '-y', '--default-toolchain', 'stable'
Remove-Item $env:TEMP\rustup-init.exe
```

### 7. uv (Python 包管理器)
```powershell
# 当前方案已经是静默的
irm https://astral.sh/uv/install.ps1 | iex
```

## 优先级策略

### 包管理器检测顺序
1. 检测 winget（Windows 10 1809+ / Windows 11 预装）
2. 如果没有 winget，检测 Chocolatey
3. 如果都没有，安装 Chocolatey（比 winget 更容易安装）

### 工具安装策略
1. **优先使用 winget**（如果可用）- 官方、干净、可靠
2. **备选使用 Chocolatey**（如果 winget 不可用）- 社区维护、广泛支持
3. **最后使用直接下载**（如果包管理器都不可用）- 下载官方安装包

## 实施方案

### 新增 Chocolatey 支持
```typescript
// 在 tool-definitions.ts 中添加 Chocolatey
{
  name: "choco",
  displayName: "Chocolatey",
  category: "package_manager",
  description: "Windows package manager (community)",
  priority: 80, // 低于 winget
  installCommands: {
    win32: `powershell -c "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"`,
  },
}
```

### 更新安装命令
所有工具添加三种安装方式：
```typescript
{
  name: "git",
  installCommands: {
    win32: "winget install Git.Git --silent --accept-package-agreements --accept-source-agreements",
  },
  fallbackCommands: {
    win32: [
      "choco install git -y",  // 备选1: Chocolatey
      // 备选2: 直接下载（作为最后手段）
    ]
  }
}
```

## 关键改进

### 1. 静默安装参数
- winget: `--silent --accept-package-agreements --accept-source-agreements`
- choco: `-y` (自动确认)
- 直接下载: `/VERYSILENT /NORESTART` (NSIS) 或 `/quiet` (MSI)

### 2. 错误处理
- 如果主安装方式失败，自动尝试备选方案
- 记录失败原因，提供诊断信息

### 3. PATH 更新
- 安装后自动刷新环境变量
- 通知用户可能需要重启应用以更新 PATH

## 用户体验

**之前**:
```
点击安装 → 打开 Store → 用户手动点击 → 等待下载 → 用户手动安装 → 刷新检测
```

**之后**:
```
点击安装 → 自动下载安装 → 完成（可能需要刷新或重启）
```
