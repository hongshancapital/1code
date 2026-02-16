---
name: learn-from-mistakes
description: "This skill should be used when the user says \"remember this mistake\", \"learn from this error\", \"add to lessons learned\", \"document this lesson\", or after making an error, receiving a correction, misunderstanding requirements, or identifying improvement opportunities. Documents lessons learned into CLAUDE.md."
allowed-tools: Read, Edit, Write
---

Document lessons learned from mistakes and corrections into CLAUDE.md for future reference.

## When to Apply

- After making an error that the user corrects
- After misunderstanding requirements
- After using the wrong approach or tool
- After receiving feedback on code quality
- When identifying patterns to avoid

## Process

1. **Identify the mistake** — Determine what went wrong.
2. **Find root cause** — Analyze why it happened.
3. **Extract lesson** — Define what to do differently.
4. **Document concisely** — Append to CLAUDE.md.

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
