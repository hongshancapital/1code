---
name: daily-guard
description: "This skill should be used when the user encounters \"non-ASCII paths\", \"Chinese characters in filenames\", \"encoding issues\", \"force push\", \"reset --hard\", \"delete branch\", \"modify config files\", \"cross-platform commands\", or works with paths containing spaces, credential files, or destructive git operations. Covers encoding, path safety, file backup, platform-specific quirks, and destructive operation guards."
allowed-tools: Read, Bash, Edit, Write, Glob, Grep
---

A collection of guards and best practices for daily development tasks. Apply proactively to prevent common issues.

## Quick Reference Index

| Guide | Triggers | Key Points |
|-------|----------|------------|
| [encoding](guides/encoding.md) | Non-ASCII paths, Chinese characters, UTF-8/GBK | Platform detection, encoding flags |
| [file-safety](guides/file-safety.md) | Config files, credentials, important data | Backup before modify, confirm destructive ops |
| [path-handling](guides/path-handling.md) | Spaces in paths, Windows vs Unix, relative paths | Quote paths, normalize separators |
| [git-safety](guides/git-safety.md) | force push, reset --hard, branch deletion | Confirm destructive git operations |
| [platform-quirks](guides/platform-quirks.md) | Windows CMD, PowerShell, macOS, Linux | Platform-specific command variations |

## When to Apply

### Encoding Issues
- Path contains non-ASCII characters (Chinese, Japanese, etc.)
- Reading/writing files with special characters in name
- Running commands that output non-English text
- Windows systems with GBK/GB2312 locale

### File Safety
- Modifying config files: `.env`, `settings.json`, `config.*`
- Editing credentials: `*.pem`, `*.key`, `id_rsa`, `.npmrc`
- System files: `/etc/*`, `~/.bashrc`, `~/.zshrc`
- Database files: `*.db`, `*.sqlite`

### Path Handling
- Paths with spaces or special characters
- Cross-platform path construction
- Relative path resolution
- Home directory expansion

### Git Safety
- Commands with `--force`, `--hard`, `-f`
- Operations on `main`/`master` branch
- Deleting branches or tags
- Rewriting history

### Platform Quirks
- Shell syntax differences (bash vs cmd vs powershell)
- Line ending issues (CRLF vs LF)
- Permission handling (chmod on Unix, ACLs on Windows)
- Process management differences

## Core Rules

1. **Detect Before Act**: Check platform, encoding, and context before operations
2. **Backup Critical Files**: Always suggest backup for config/credential files
3. **Confirm Destructive**: Prompt user before irreversible operations
4. **Quote All Paths**: Use quotes for paths with potential spaces
5. **Platform Aware**: Adapt commands to current OS

## Usage Pattern

When encountering a potential issue:

```
1. Identify the risk category (encoding, safety, path, git, platform)
2. Read the relevant guide for detailed handling
3. Apply the appropriate safeguard
4. Inform user of any precautions taken
```
