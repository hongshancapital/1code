---
name: learn-from-mistakes
description: Document lessons learned from errors into CLAUDE.md. Use after making mistakes, receiving corrections, or identifying improvement opportunities.
allowed-tools: Read, Edit, Write
---

When a mistake occurs or user provides correction, document the lesson in CLAUDE.md.

## When to Use

- After making an error that user corrects
- After misunderstanding requirements
- After using wrong approach or tool
- After receiving feedback on code quality
- When identifying patterns to avoid

## Process

1. **Identify the mistake**: What went wrong?
2. **Find root cause**: Why did it happen?
3. **Extract lesson**: What to do differently?
4. **Document concisely**: Add to CLAUDE.md

## Format

Append to CLAUDE.md under a `## Lessons Learned` section:

```markdown
## Lessons Learned

- **[Category]**: [Concise lesson]. Example: [Brief example if needed].
```

Categories: `Path`, `API`, `Logic`, `Style`, `Tool`, `Assumption`, `Type`, `Async`, `Config`, `Git`, `Test`, `Perf`, `Security`, `UX`, `Docs`

## Examples

```markdown
## Lessons Learned

- **Path**: Use `../../` not `../../../../` from `out/main` to reach project root.
- **API**: Check if method exists before calling; prefer optional chaining.
- **Assumption**: Always verify file structure before assuming paths.
- **Tool**: Use Glob for file search, not Bash find.
- **Type**: Update all related type definitions when adding new enum values.
- **Async**: Always handle promise rejection in parallel Promise.all calls.
- **Config**: Check both dev and prod paths when accessing bundled resources.
```

## Rules

- Keep each lesson to ONE line
- Be specific, not generic
- Include concrete example when helpful
- No duplicates - check existing lessons first
- Max 100 lessons per project (archive old ones if needed)
