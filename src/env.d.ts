/// <reference types="vite/client" />

import "react"

// Extend React's CSSProperties to include Electron-specific properties
declare module "react" {
  interface CSSProperties {
    /**
     * Electron window dragging property
     * - "drag": Makes the element draggable for window movement
     * - "no-drag": Prevents dragging on child elements
     */
    WebkitAppRegion?: "drag" | "no-drag"
  }
}

// Extend Vite's ImportMetaEnv with our custom env vars
declare global {
  interface ImportMetaEnv {
    // Main process - Required (MAIN_VITE_ prefix)
    readonly MAIN_VITE_OKTA_ISSUER: string
    readonly MAIN_VITE_OKTA_CLIENT_ID: string
    // Note: OKTA_CALLBACK is auto-generated based on dev/production mode (port 3300/3000)
    readonly MAIN_VITE_API_URL: string
    readonly MAIN_VITE_API_ORIGIN: string

    // Main process - Optional
    readonly MAIN_VITE_SENTRY_DSN?: string
    readonly MAIN_VITE_OPENAI_API_KEY?: string
    readonly MAIN_VITE_POSTHOG_KEY?: string
    readonly MAIN_VITE_POSTHOG_HOST?: string

    // Renderer process - Optional (VITE_ prefix)
    readonly VITE_POSTHOG_KEY?: string
    readonly VITE_POSTHOG_HOST?: string
    readonly VITE_FEEDBACK_URL?: string
  }

  /**
   * Electron's webUtils API exposed to renderer process
   * Used for getting file paths from File objects in drag-and-drop operations
   */
  interface Window {
    webUtils?: {
      getPathForFile(file: File): string
    }
    /** Force enable analytics in development mode */
    __FORCE_ANALYTICS__?: boolean
  }

  // Main process global extensions (extends globalThis for Node.js/Electron main process)
  /** Callback to update available state from auto-updater */
  // eslint-disable-next-line no-var
  var __setUpdateAvailable: ((available: boolean, version?: string) => void) | undefined
  /** Flag to track if devTools have been unlocked */
  // eslint-disable-next-line no-var
  var __devToolsUnlocked: boolean | undefined
  /** Callback to unlock devTools */
  // eslint-disable-next-line no-var
  var __unlockDevTools: (() => void) | undefined
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
