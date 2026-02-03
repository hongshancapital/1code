# Path Handling Guide

## Universal Rules

1. **Always quote paths** - `"$PATH"` not `$PATH`
2. **Use forward slashes** - Works on all platforms in most tools
3. **Normalize before compare** - Resolve `.` and `..` first
4. **Check existence before use** - Don't assume paths exist

## Spaces in Paths

### Bash/Zsh
```bash
# Wrong
cd /Users/My Documents/project

# Correct
cd "/Users/My Documents/project"
cd '/Users/My Documents/project'
cd /Users/My\ Documents/project
```

### Windows CMD
```cmd
:: Wrong
cd C:\Program Files\App

:: Correct
cd "C:\Program Files\App"
```

### PowerShell
```powershell
# Use quotes or backticks
cd "C:\Program Files\App"
cd C:\Program` Files\App
```

## Cross-Platform Path Construction

### Node.js
```javascript
const path = require('path');

// Always use path.join, never string concatenation
const filePath = path.join(__dirname, 'data', 'file.txt');

// Normalize separators
const normalized = path.normalize(userInput);

// Convert to platform-specific
const platformPath = path.resolve(relativePath);
```

### Python
```python
from pathlib import Path

# Use Path objects
file_path = Path(__file__).parent / 'data' / 'file.txt'

# Or os.path.join
import os
file_path = os.path.join(os.path.dirname(__file__), 'data', 'file.txt')
```

## Home Directory Expansion

### Bash
```bash
# Expand ~
cd ~
cd ~/projects
cd "$HOME/projects"  # Quoted for safety
```

### Node.js
```javascript
const os = require('os');
const path = require('path');

// Never use '~' directly - expand it
const homePath = path.join(os.homedir(), '.config');
```

### Python
```python
from pathlib import Path

# Expand ~
config_path = Path('~/.config').expanduser()

# Or
import os
config_path = os.path.expanduser('~/.config')
```

## Relative Path Pitfalls

### Working Directory Issues
```bash
# Problem: Script runs from different directories
cat data/file.txt  # Fails if pwd isn't project root

# Solution: Use script's directory as base
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cat "$SCRIPT_DIR/data/file.txt"
```

### Node.js `__dirname` vs `process.cwd()`
```javascript
// __dirname: directory of current file (stable)
// process.cwd(): where node was invoked from (varies)

// Use __dirname for files relative to your code
const configPath = path.join(__dirname, 'config.json');

// Use process.cwd() for user's project files
const userFile = path.join(process.cwd(), 'package.json');
```

## Path Separator Reference

| Platform | Native | Also Works |
|----------|--------|------------|
| Windows | `\` | `/` in most tools |
| macOS | `/` | - |
| Linux | `/` | - |

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| String concat | Platform mismatch | Use `path.join()` |
| Unquoted vars | Breaks on spaces | Always quote `"$var"` |
| Hardcoded `/` | Windows issues | Use `path.sep` or join |
| Assuming cwd | Wrong base dir | Use `__dirname` |
| Raw `~` | Not expanded | Use `os.homedir()` |
