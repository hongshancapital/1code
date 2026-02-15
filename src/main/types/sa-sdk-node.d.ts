declare module "sa-sdk-node" {
  class SensorsAnalytics {
    constructor()
    submitTo(
      url: string,
      options?: { mode?: "track" | "debug" | "dryRun" },
    ): Promise<void>
    track(
      distinctId: string,
      eventName: string,
      properties?: Record<string, unknown>,
    ): void
    trackSignup(
      distinctId: string,
      originalId: string,
      properties?: Record<string, unknown>,
    ): void
    profileSet(
      distinctId: string,
      properties?: Record<string, unknown>,
    ): void
    onCompleted(): void
  }
  export default SensorsAnalytics
}
