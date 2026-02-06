/**
 * Tool Definitions
 *
 * Defines all tools that can be detected across platforms
 */

import type { ToolDefinition } from "./types"

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ============================================================================
  // Package Managers
  // ============================================================================

  // macOS - Homebrew
  {
    name: "brew",
    displayName: "Homebrew",
    category: "package_manager",
    description: "macOS package manager",
    priority: 100,
    versionParser: (output) => {
      const match = output.match(/Homebrew\s+(\d+\.\d+\.\d+)/)
      return match ? match[1] : output.split("\n")[0].trim()
    },
    installCommands: {
      darwin: 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    },
  },

  // Windows - Winget
  {
    name: "winget",
    displayName: "Windows Package Manager",
    category: "package_manager",
    description: "Windows package manager",
    priority: 100,
    versionParser: (output) => {
      const match = output.match(/v(\d+\.\d+\.\d+)/)
      return match ? match[1] : output.split("\n")[0].trim()
    },
    installCommands: {
      // winget 通常预装在 Windows 10 1809+ 和 Windows 11
      // 如果没有，需要从 Microsoft Store 安装 "App Installer"
      // 这里提供手动安装链接，因为自动安装需要 Store
      win32: 'start ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1',
    },
  },

  // Linux - APT
  {
    name: "apt",
    displayName: "APT",
    category: "package_manager",
    description: "Debian/Ubuntu package manager",
    priority: 100,
    versionParser: (output) => {
      const match = output.match(/apt\s+(\d+\.\d+(?:\.\d+)?)/)
      return match ? match[1] : output.split(" ")[1]
    },
    installCommands: {},
  },

  // Linux - DNF
  {
    name: "dnf",
    displayName: "DNF",
    category: "package_manager",
    description: "Fedora/RHEL package manager",
    priority: 90,
    versionParser: (output) => {
      const match = output.match(/dnf\s+(\d+\.\d+(?:\.\d+)?)/)
      return match ? match[1] : output.split(" ")[1]
    },
    installCommands: {},
  },

  // Linux - YUM
  {
    name: "yum",
    displayName: "YUM",
    category: "package_manager",
    description: "CentOS/RHEL package manager",
    priority: 80,
    versionParser: (output) => {
      const match = output.match(/yum\s+(\d+\.\d+(?:\.\d+)?)/)
      return match ? match[1] : output.split(" ")[1]
    },
    installCommands: {},
  },

  // Linux - Pacman
  {
    name: "pacman",
    displayName: "Pacman",
    category: "package_manager",
    description: "Arch Linux package manager",
    priority: 85,
    versionParser: (output) => {
      const match = output.match(/Pacman\s+v?(\d+\.\d+(?:\.\d+)?)/)
      return match ? match[1] : output.split(" ")[1]?.replace("v", "")
    },
    installCommands: {},
  },

  // Linux - Zypper
  {
    name: "zypper",
    displayName: "Zypper",
    category: "package_manager",
    description: "openSUSE package manager",
    priority: 75,
    versionParser: (output) => {
      const match = output.match(/zypper\s+(\d+\.\d+(?:\.\d+)?)/)
      return match ? match[1] : output.split(" ")[1]
    },
    installCommands: {},
  },

  // ============================================================================
  // Version Control
  // ============================================================================
  {
    name: "git",
    displayName: "Git",
    category: "vcs",
    description: "Version control system",
    priority: 100,
    minVersion: "2.0.0",
    versionParser: (output) => output.replace(/^git version\s*/, "").split(" ")[0],
    installCommands: {
      darwin: "brew install git",
      win32: "winget install Git.Git",
      linux: "sudo apt install git",
    },
  },

  // ============================================================================
  // Search Tools
  // ============================================================================
  {
    name: "rg",
    displayName: "ripgrep",
    category: "search",
    description: "Fast file content search",
    priority: 100,
    minVersion: "13.0.0",
    versionParser: (output) => output.replace(/^ripgrep\s*/, "").split(" ")[0],
    installCommands: {
      darwin: "brew install ripgrep",
      win32: "winget install BurntSushi.ripgrep.MSVC",
      linux: "sudo apt install ripgrep",
    },
  },

  // ============================================================================
  // JSON Processor
  // ============================================================================
  {
    name: "jq",
    displayName: "jq",
    category: "json",
    description: "JSON processor",
    priority: 100,
    minVersion: "1.6",
    versionParser: (output) => output.replace(/^jq-/, ""),
    installCommands: {
      darwin: "brew install jq",
      win32: "winget install jqlang.jq",
      linux: "sudo apt install jq",
    },
  },

  // ============================================================================
  // Network Tools
  // ============================================================================
  {
    name: "curl",
    displayName: "curl",
    category: "network",
    description: "HTTP client",
    priority: 100,
    minVersion: "7.0.0",
    versionParser: (output) => output.split(" ")[1],
    installCommands: {
      darwin: "brew install curl",
      win32: "winget install cURL.cURL",
      linux: "sudo apt install curl",
    },
  },

  // ============================================================================
  // JavaScript Runtimes
  // ============================================================================
  {
    name: "bun",
    displayName: "Bun",
    category: "js_runtime",
    description: "Fast JavaScript runtime",
    priority: 100,
    minVersion: "1.0.0",
    installCommands: {
      darwin: "brew install oven-sh/bun/bun",
      win32: "powershell -c \"irm bun.sh/install.ps1|iex\"",
      linux: "curl -fsSL https://bun.sh/install | bash",
    },
  },
  {
    name: "node",
    displayName: "Node.js",
    category: "js_runtime",
    description: "JavaScript runtime",
    priority: 50,
    minVersion: "18.0.0",
    installCommands: {
      darwin: "brew install node",
      win32: "winget install OpenJS.NodeJS.LTS",
      linux: "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install nodejs",
    },
  },

  // ============================================================================
  // Python Runtime
  // ============================================================================
  {
    name: "python3",
    displayName: "Python",
    category: "python_runtime",
    description: "Python interpreter",
    priority: 100,
    minVersion: "3.10.0",
    versionParser: (output) => {
      const match = output.match(/Python\s+(\d+\.\d+\.\d+)/)
      return match ? match[1] : output.replace(/^Python\s*/, "").split("\n")[0].trim()
    },
    installCommands: {
      darwin: "brew install python",
      win32: "winget install Python.Python.3.12",
      linux: "sudo apt install python3",
    },
  },

  // ============================================================================
  // Python Package Managers
  // ============================================================================
  {
    name: "uv",
    displayName: "uv",
    category: "python_pkg",
    description: "Fast Python package manager",
    priority: 100,
    minVersion: "0.1.0",
    versionParser: (output) => {
      const match = output.match(/uv\s+(\d+\.\d+\.\d+)/)
      return match ? match[1] : output.split(" ")[1] || output.trim()
    },
    installCommands: {
      darwin: "brew install uv",
      win32: "powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"",
      linux: "curl -LsSf https://astral.sh/uv/install.sh | sh",
    },
  },
  {
    name: "pip3",
    displayName: "pip",
    category: "python_pkg",
    description: "Python package installer",
    priority: 50,
    versionParser: (output) => {
      const match = output.match(/pip\s+(\d+\.\d+(?:\.\d+)?)/)
      return match ? match[1] : output.split(" ")[1] || output.trim()
    },
    installCommands: {
      darwin: "python3 -m ensurepip --upgrade",
      win32: "python -m ensurepip --upgrade",
      linux: "sudo apt install python3-pip",
    },
  },

  // ============================================================================
  // Go Runtime
  // ============================================================================
  {
    name: "go",
    displayName: "Go",
    category: "go_runtime",
    description: "Go programming language",
    priority: 100,
    minVersion: "1.20.0",
    versionParser: (output) => {
      const match = output.match(/go(\d+\.\d+(?:\.\d+)?)/)
      return match ? match[1] : output
    },
    versionFlag: "version",
    installCommands: {
      darwin: "open https://go.dev/dl/",
      win32: "start https://go.dev/dl/",
      linux: "xdg-open https://go.dev/dl/ || echo 'Download from https://go.dev/dl/'",
    },
  },

  // ============================================================================
  // Rust Runtime
  // ============================================================================
  {
    name: "rustc",
    displayName: "Rust",
    category: "rust_runtime",
    description: "Rust compiler",
    priority: 100,
    minVersion: "1.70.0",
    versionParser: (output) => {
      const match = output.match(/rustc\s+(\d+\.\d+\.\d+)/)
      return match ? match[1] : output.split(" ")[1]
    },
    installCommands: {
      darwin: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
      // Windows: Download and run rustup-init with default options
      // Note: Requires restart of shell/app to update PATH
      win32: "powershell -c \"Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile $env:TEMP\\rustup-init.exe; Start-Process -Wait -FilePath $env:TEMP\\rustup-init.exe -ArgumentList '-y'; Remove-Item $env:TEMP\\rustup-init.exe\"",
      linux: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
    },
  },
  {
    name: "cargo",
    displayName: "Cargo",
    category: "rust_runtime",
    description: "Rust package manager",
    priority: 90,
    minVersion: "1.70.0",
    versionParser: (output) => {
      const match = output.match(/cargo\s+(\d+\.\d+\.\d+)/)
      return match ? match[1] : output.split(" ")[1]
    },
    installCommands: {
      darwin: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
      // Cargo is installed with rustc via rustup
      win32: "powershell -c \"Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile $env:TEMP\\rustup-init.exe; Start-Process -Wait -FilePath $env:TEMP\\rustup-init.exe -ArgumentList '-y'; Remove-Item $env:TEMP\\rustup-init.exe\"",
      linux: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
    },
  },
]
