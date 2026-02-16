---
name: automations
description: "This skill should be used when the user asks to \"create an automation\", \"schedule a task\", \"set up a cron job\", \"run something on a schedule\", \"manage automations\", \"list my automations\", \"delete an automation\", or \"trigger an automation manually\". Provides guidance for managing background automations via tRPC APIs."
---

# Automations Management

Manage background automations using the following tRPC procedures.

## Workflow

1. List existing automations to understand current setup.
2. Create, update, or delete automations as needed.
3. Verify by listing again or triggering manually.
4. Check execution history to confirm successful runs.

## API Reference

### List Automations
Call `trpc.automations.list` to retrieve all automations.

### Create Automation
Call `trpc.automations.create` with:
- name: string — Name of the automation
- triggers: Array of trigger configs, e.g. `[{ type: "cron", config: { expression: "0 9 * * *" } }]`
- agentPrompt: string — Instructions for the AI agent to follow
- actions: Array of action configs, e.g. `[{ type: "inbox" }]`

### Update Automation
Call `trpc.automations.update` with:
- id: string — Automation ID
- name?: string — New name (optional)
- isEnabled?: boolean — Enable/disable (optional)
- triggers?: Array — New triggers (optional)
- agentPrompt?: string — New instructions (optional)
- actions?: Array — New actions (optional)

### Delete Automation
Call `trpc.automations.delete` with:
- id: string — Automation ID to delete

### Trigger Manually
Call `trpc.automations.trigger` with:
- id: string — Automation ID to execute immediately

### View Execution History
Call `trpc.automations.listExecutions` with:
- automationId?: string — Filter by automation (optional)
- limit?: number — Max results (default 20)

## Cron Expression Examples

| Expression | Schedule |
|-----------|----------|
| `0 9 * * *` | Every day at 9:00 AM |
| `0 */6 * * *` | Every 6 hours |
| `0 9 * * 1` | Every Monday at 9:00 AM |
| `0 9 1 * *` | First day of every month at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/30 * * * *` | Every 30 minutes |

## Action Types

### Inbox Action
Creates a new chat in the user's Inbox with the AI agent's response.
```json
{ "type": "inbox" }
```

## Example: Daily Standup Automation

```typescript
await trpc.automations.create({
  name: "Daily Standup Summary",
  triggers: [{ type: "cron", config: { expression: "0 9 * * 1-5" } }],
  agentPrompt: "Check the project status and create a summary of: 1) What was done yesterday 2) What's planned for today 3) Any blockers",
  actions: [{ type: "inbox" }]
})
```
