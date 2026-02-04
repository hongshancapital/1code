---
name: automations
description: Manage background automations that run on schedules
---

# Automations Management

You can manage the user's automations using these MCP tools:

## List Automations
Use `trpc.automations.list` to see all automations.

## Create Automation
Use `trpc.automations.create` with:
- name: string - Name of the automation
- triggers: Array of trigger configs, e.g. `[{ type: "cron", config: { expression: "0 9 * * *" } }]`
- agentPrompt: string - Instructions for the AI agent to follow
- actions: Array of action configs, e.g. `[{ type: "inbox" }]`

### Cron Expression Examples
- `0 9 * * *` - Every day at 9:00 AM
- `0 */6 * * *` - Every 6 hours
- `0 9 * * 1` - Every Monday at 9:00 AM
- `0 9 1 * *` - First day of every month at 9:00 AM

## Update Automation
Use `trpc.automations.update` with:
- id: string - Automation ID
- name?: string - New name (optional)
- isEnabled?: boolean - Enable/disable (optional)
- triggers?: Array - New triggers (optional)
- agentPrompt?: string - New instructions (optional)
- actions?: Array - New actions (optional)

## Delete Automation
Use `trpc.automations.delete` with:
- id: string - Automation ID to delete

## Trigger Manually
Use `trpc.automations.trigger` with:
- id: string - Automation ID to execute immediately

## View Execution History
Use `trpc.automations.listExecutions` with:
- automationId?: string - Filter by automation (optional)
- limit?: number - Max results (default 20)

## Action Types

### Inbox Action
Creates a new chat in the user's Inbox with the AI agent's response.
```json
{ "type": "inbox" }
```

## Example: Create a Daily Standup Automation

```typescript
await trpc.automations.create({
  name: "Daily Standup Summary",
  triggers: [{ type: "cron", config: { expression: "0 9 * * 1-5" } }],
  agentPrompt: "Check the project status and create a summary of: 1) What was done yesterday 2) What's planned for today 3) Any blockers",
  actions: [{ type: "inbox" }]
})
```
