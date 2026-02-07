import { Component, type ReactNode } from "react"
import { AlertCircle } from "lucide-react"
import { Button } from "./button"

interface ErrorBoundaryProps {
  children: ReactNode
  viewerType?: string
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ViewerErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[ViewerErrorBoundary] ${this.props.viewerType || "viewer"} crashed:`,
      error,
      errorInfo,
    )

    // 上报到 Sentry
    import("@sentry/electron/renderer")
      .then((Sentry) => {
        Sentry.captureException(error, {
          tags: {
            errorCategory: "ui-viewer-crash",
            errorBoundary: "viewer",
            viewerType: this.props.viewerType || "unknown",
          },
          extra: {
            componentStack: errorInfo.componentStack,
            errorMessage: error.message,
            errorStack: error.stack,
          },
          level: "error",
        })
      })
      .catch(() => {
        // Sentry 未加载（如开发模式），忽略
      })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
          <AlertCircle className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium text-foreground">
            Failed to render {this.props.viewerType || "file"}
          </p>
          <p className="text-sm text-muted-foreground max-w-[300px]">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <Button variant="outline" size="sm" onClick={this.handleReset}>
            Try again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
