# Platform Quirks Guide

## Shell Syntax Differences

### Variable Expansion

| Shell | Syntax | Example |
|-------|--------|---------|
| Bash/Zsh | `$VAR` or `${VAR}` | `echo $HOME` |
| CMD | `%VAR%` | `echo %USERPROFILE%` |
| PowerShell | `$env:VAR` | `echo $env:USERPROFILE` |

### Environment Variables

```bash
# Bash/Zsh - Set for command
VAR=value command

# Bash/Zsh - Export
export VAR=value

# CMD
set VAR=value

# PowerShell
$env:VAR = "value"
```

### Command Chaining

| Shell | AND | OR | Sequence |
|-------|-----|-----|----------|
| Bash/Zsh | `&&` | `\|\|` | `;` |
| CMD | `&&` | `\|\|` | `&` |
| PowerShell | `-and` / `;` | `-or` | `;` |

## Line Endings

### Detection
```bash
# Check line endings
file myfile.txt
# or
cat -A myfile.txt | head -1  # Shows ^M for CRLF
```

### Conversion
```bash
# Unix to Windows
unix2dos file.txt
# or
sed -i 's/$/\r/' file.txt

# Windows to Unix
dos2unix file.txt
# or
sed -i 's/\r$//' file.txt
```

### Git Configuration
```bash
# Auto-convert on Windows
git config --global core.autocrlf true

# No conversion (for cross-platform projects)
git config --global core.autocrlf input  # Unix
git config --global core.autocrlf false  # Explicit
```

## Permission Handling

### Unix (chmod)
```bash
# Make executable
chmod +x script.sh
chmod 755 script.sh

# Read-only
chmod 444 file.txt

# Check permissions
ls -la file.txt
```

### Windows
```powershell
# Read-only
attrib +R file.txt

# Remove read-only
attrib -R file.txt

# Check
attrib file.txt
```

## Process Management

### Kill Process

```bash
# Unix - by name
pkill -f "process_name"
killall process_name

# Unix - by PID
kill 1234
kill -9 1234  # Force

# Windows CMD
taskkill /IM "process.exe"
taskkill /F /IM "process.exe"  # Force
taskkill /PID 1234

# PowerShell
Stop-Process -Name "process"
Stop-Process -Id 1234 -Force
```

### Find Process

```bash
# Unix
ps aux | grep process_name
pgrep -f process_name
lsof -i :8080  # By port

# Windows
tasklist | findstr "process"
netstat -ano | findstr ":8080"  # By port

# PowerShell
Get-Process | Where-Object {$_.Name -like "*process*"}
Get-NetTCPConnection -LocalPort 8080
```

## Common Command Equivalents

| Task | Unix | Windows CMD | PowerShell |
|------|------|-------------|------------|
| List files | `ls -la` | `dir` | `Get-ChildItem` |
| Copy | `cp -r` | `xcopy /E` | `Copy-Item -Recurse` |
| Move | `mv` | `move` | `Move-Item` |
| Delete | `rm -rf` | `rmdir /S /Q` | `Remove-Item -Recurse -Force` |
| Find text | `grep` | `findstr` | `Select-String` |
| Print file | `cat` | `type` | `Get-Content` |
| Clear screen | `clear` | `cls` | `Clear-Host` |
| Current dir | `pwd` | `cd` | `Get-Location` |
| Set env var | `export X=y` | `set X=y` | `$env:X="y"` |

## Shebang Lines

```bash
#!/bin/bash           # Bash
#!/bin/sh             # POSIX shell
#!/usr/bin/env bash   # Portable bash
#!/usr/bin/env python3  # Python
#!/usr/bin/env node   # Node.js
```

**Note**: Windows ignores shebang but uses file associations.

## Null Device

| Platform | Null Device |
|----------|-------------|
| Unix | `/dev/null` |
| Windows | `NUL` |

```bash
# Unix
command > /dev/null 2>&1

# Windows CMD
command > NUL 2>&1

# PowerShell
command | Out-Null
command 2>&1 | Out-Null
```
