export interface TriggerData {
  triggeredBy: "cron" | "webhook" | "startup-missed" | "manual"
  triggerData?: Record<string, any>
}

export interface TriggerConfig {
  type: "cron" | "webhook" | "api" | "signal"
  config: Record<string, any>
}

export interface ActionConfig {
  type: "inbox" | "api" | "file" | "mcp" | "http"
  config: Record<string, any>
}
