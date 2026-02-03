# File Safety Guide

## Critical Files - Always Backup First

### Configuration Files
```
.env, .env.local, .env.production
config.json, settings.json, config.yaml
*.config.js, *.config.ts
package.json (especially scripts section)
tsconfig.json, jsconfig.json
```

### Credentials & Keys
```
*.pem, *.key, *.crt, *.p12
id_rsa, id_ed25519, *.pub
.npmrc, .yarnrc (may contain tokens)
.netrc, .git-credentials
credentials.json, service-account.json
```

### System & Profile
```
~/.bashrc, ~/.zshrc, ~/.profile
~/.gitconfig, ~/.ssh/config
/etc/* (any system config)
crontab entries
```

### Data Files
```
*.db, *.sqlite, *.sqlite3
*.json (if used as data store)
*.csv, *.xlsx (if source of truth)
```

## Backup Protocol

### Before Modifying Critical Files
```bash
# Create timestamped backup
cp "important.config" "important.config.bak.$(date +%Y%m%d_%H%M%S)"

# Or use a dedicated backup dir
mkdir -p ~/.config-backups
cp "~/.zshrc" "~/.config-backups/zshrc.$(date +%Y%m%d_%H%M%S)"
```

### For Databases
```bash
# SQLite
cp "data.db" "data.db.backup"
# Or use dump
sqlite3 data.db ".backup 'data.db.backup'"
```

## Confirmation Prompts

### When to Ask User

1. **File doesn't exist but should**: "File X not found. Create it?"
2. **Modifying config files**: "About to modify .env - backup created at .env.bak"
3. **Deleting files**: "This will delete X files. Proceed?"
4. **Overwriting existing**: "File exists. Overwrite?"

### Destructive Operation Patterns

```
rm -rf       → Always confirm, show what will be deleted
> file       → Warn about overwrite, suggest >> for append
truncate     → Confirm data loss
DROP TABLE   → Confirm in production context
```

## Safe Modification Pattern

```bash
# 1. Check if file exists
if [ -f "$FILE" ]; then
  # 2. Create backup
  cp "$FILE" "$FILE.bak"
  # 3. Make changes
  # ... edit operations ...
  # 4. Verify changes
  diff "$FILE.bak" "$FILE"
fi
```

## Recovery Hints

### If Something Goes Wrong

```bash
# Restore from backup
cp "$FILE.bak" "$FILE"

# Find recent backups
ls -la *.bak* | head -10

# Git recovery (if tracked)
git checkout -- "$FILE"
git stash
```

## Risk Matrix

| File Type | Risk Level | Action Required |
|-----------|------------|-----------------|
| Credentials | Critical | Backup + Confirm |
| Config | High | Backup |
| Source code | Medium | Git handles |
| Generated | Low | Can regenerate |
| Temp files | None | Safe to modify |
