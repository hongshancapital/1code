/// <reference types="vite/client" />

// Extend Vite's ImportMetaEnv with our custom env vars
declare global {
  interface ImportMetaEnv {
    // Main process (MAIN_VITE_ prefix)
    readonly MAIN_VITE_SENTRY_DSN?: string
    readonly MAIN_VITE_POSTHOG_KEY?: string
    readonly MAIN_VITE_POSTHOG_HOST?: string

    // Renderer process (VITE_ prefix)
    readonly VITE_POSTHOG_KEY?: string
    readonly VITE_POSTHOG_HOST?: string
  }
}

// Type declarations for pptx-preview
declare module "pptx-preview" {
  interface PptxPreviewerOptions {
    width?: number
    height?: number
  }

  interface PptxPreviewer {
    preview(arrayBuffer: ArrayBuffer): Promise<void>
    destroy?(): void
  }

  export function init(
    container: HTMLElement,
    options?: PptxPreviewerOptions
  ): PptxPreviewer
}

export {}
