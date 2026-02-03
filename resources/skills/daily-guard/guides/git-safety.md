# Git Safety Guide

## Destructive Commands - Always Confirm

### Force Push
```bash
# DANGER: Rewrites remote history
git push --force
git push -f
git push origin main --force

# Safer alternative
git push --force-with-lease  # Fails if remote has new commits
```

### Hard Reset
```bash
# DANGER: Discards all uncommitted changes
git reset --hard
git reset --hard HEAD~3
git checkout -- .
git restore .

# Before reset, check what will be lost
git status
git stash  # Save changes first
```

### Branch Deletion
```bash
# DANGER: Deletes local branch
git branch -D feature  # Force delete

# DANGER: Deletes remote branch
git push origin --delete feature
git push origin :feature

# Safer: Use -d (only deletes if merged)
git branch -d feature
```

### History Rewrite
```bash
# DANGER: Modifies commit history
git rebase -i HEAD~5
git commit --amend
git filter-branch

# Safe alternative for recent commit message
git commit --amend -m "new message"  # Only if not pushed
```

## Protected Branches

### Commands to Block on main/master
```bash
# Never force push to main
git push --force origin main  # BLOCK

# Never reset main
git reset --hard origin/main  # WARN if on main

# Never delete main
git branch -D main  # BLOCK
```

## Safe Workflow

### Before Destructive Operations
```bash
# 1. Check current branch
git branch --show-current

# 2. Check status
git status

# 3. Create backup branch
git branch backup-$(date +%Y%m%d)

# 4. Stash uncommitted changes
git stash push -m "backup before reset"
```

### Recovery Options
```bash
# Find lost commits
git reflog

# Restore from reflog
git checkout HEAD@{2}
git reset --hard HEAD@{2}

# Recover deleted branch
git checkout -b recovered-branch HEAD@{5}

# Recover stashed changes
git stash list
git stash pop
```

## Risk Matrix

| Command | Risk | Mitigation |
|---------|------|------------|
| `push --force` | Critical | Use `--force-with-lease` |
| `reset --hard` | High | Stash first |
| `clean -fd` | High | Use `-n` dry run first |
| `branch -D` | Medium | Use `-d` instead |
| `checkout -- .` | Medium | Stash first |
| `rebase -i` | Medium | Backup branch first |

## Confirmation Prompts

### When to Ask User

1. **Force push**: "This will rewrite remote history. Proceed?"
2. **Reset hard**: "This will discard N uncommitted changes. Proceed?"
3. **Delete branch**: "Delete branch 'X'? (merged: yes/no)"
4. **On protected branch**: "You're on main. This operation is dangerous."

## Git Config Safety

```bash
# Prevent accidental push to main
git config --global branch.main.pushRemote no_push

# Require force-with-lease
git config --global alias.fpush "push --force-with-lease"

# Show branch in prompt (helps awareness)
# Add to .bashrc/.zshrc
```
