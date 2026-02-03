# Encoding Guide

## Problem Scenarios

### Windows Chinese Path Issues
```
Error: [Errno 2] No such file or directory: 'C:\Users\用户\项目'
UnicodeDecodeError: 'gbk' codec can't decode byte...
```

### Detection
```bash
# Check system locale
# Windows PowerShell
[System.Text.Encoding]::Default.EncodingName

# Unix
locale
echo $LANG
```

## Solutions

### Python File Operations
```python
# Always specify encoding explicitly
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# For Windows GBK files
with open(path, 'r', encoding='gbk', errors='replace') as f:
    content = f.read()
```

### Node.js
```javascript
// Read with explicit encoding
const content = fs.readFileSync(path, { encoding: 'utf-8' });

// For GBK (requires iconv-lite)
const iconv = require('iconv-lite');
const buffer = fs.readFileSync(path);
const content = iconv.decode(buffer, 'gbk');
```

### Git Operations
```bash
# Configure Git for UTF-8 paths
git config --global core.quotepath false
git config --global i18n.logoutputencoding utf-8
git config --global i18n.commitencoding utf-8

# Windows specific
git config --global core.autocrlf true
```

### Command Output (Windows)
```powershell
# Set console to UTF-8
chcp 65001
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

# Or in CMD
chcp 65001
```

## Quick Checks

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Garbled Chinese | Wrong encoding read | Specify `encoding='utf-8'` or `'gbk'` |
| Path not found (Chinese) | Encoding mismatch | Use raw strings `r"path"` in Python |
| Git shows escaped chars | quotepath enabled | `git config core.quotepath false` |
| Console garbled output | Wrong codepage | `chcp 65001` for UTF-8 |

## Platform Matrix

| OS | Default Encoding | Recommendation |
|----|-----------------|----------------|
| Windows (Chinese) | GBK/CP936 | Set UTF-8 explicitly |
| Windows (English) | CP1252 | Set UTF-8 explicitly |
| macOS | UTF-8 | Usually OK |
| Linux | UTF-8 | Usually OK |
