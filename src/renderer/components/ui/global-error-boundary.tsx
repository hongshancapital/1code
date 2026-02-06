import { Component, type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { Copy, Check } from "lucide-react"
import { Button } from "./button"
import i18n from "../../lib/i18n"

interface GlobalErrorBoundaryProps {
  children: ReactNode
}

interface GlobalErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

// Fallback 文案（i18n 未初始化时使用）
const FALLBACK_TEXTS = {
  zh: {
    title: "哎呀！程序崩溃了",
    message: "遇到了意外错误。别担心，刷新页面通常就能解决问题。",
    button: "刷新页面",
  },
  en: {
    title: "Oops! Something went wrong",
    message:
      "We encountered an unexpected error. Don't worry, refreshing the page usually fixes it.",
    button: "Reload Page",
  },
}

/**
 * 错误详情组件（开发模式）
 */
function ErrorDetails({
  error,
  getSafeText,
}: {
  error: Error
  getSafeText: (key: string, fallback: string) => string
}) {
  const [copied, setCopied] = useState(false)

  const errorText = error.stack || error.message

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy error:", err)
    }
  }

  return (
    <details className="mt-4 text-xs text-muted-foreground max-w-2xl w-full">
      <summary className="cursor-pointer hover:text-foreground transition-colors">
        错误详情 (开发模式)
      </summary>
      <div className="mt-2 relative">
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-2 h-7 px-2 text-xs"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1" />
              {getSafeText("actions.copied", "Copied")}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1" />
              {getSafeText("actions.copy", "Copy")}
            </>
          )}
        </Button>
        <pre className="p-3 pr-20 bg-muted rounded overflow-auto max-h-60 text-left whitespace-pre-wrap break-all">
          {errorText}
        </pre>
      </div>
    </details>
  )
}

/**
 * 错误 UI 子组件（使用 Hooks）
 */
function ErrorFallbackUI({
  error,
  onReload,
}: {
  error: Error | null
  onReload: () => void
}) {
  const { t } = useTranslation("common")

  // 根据浏览器语言选择 fallback
  const lang = navigator.language.startsWith("zh") ? "zh" : "en"
  const fallback = FALLBACK_TEXTS[lang]

  // 安全获取翻译文本（i18n 未初始化时使用 fallback）
  const getSafeText = (key: string, fallbackText: string) => {
    try {
      const translated = t(key)
      // 如果翻译结果就是 key 本身，说明翻译失败
      return translated === key ? fallbackText : translated
    } catch {
      return fallbackText
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground gap-6 p-8">
      {/* 表情符号 */}
      <div className="text-[4rem] leading-none select-none text-muted-foreground">
        :(
      </div>

      {/* 主标题 */}
      <h1 className="text-2xl font-semibold text-foreground text-center">
        {getSafeText("error.globalCrash.title", fallback.title)}
      </h1>

      {/* 描述文本 */}
      <p className="text-base text-muted-foreground text-center max-w-md">
        {getSafeText("error.globalCrash.message", fallback.message)}
      </p>

      {/* 刷新按钮 */}
      <Button onClick={onReload} size="lg">
        {getSafeText("actions.reloadPage", fallback.button)}
      </Button>

      {/* 开发模式：显示错误详情 */}
      {import.meta.env.DEV && error && (
        <ErrorDetails
          error={error}
          getSafeText={getSafeText}
        />
      )}
    </div>
  )
}

/**
 * 全局错误边界组件
 *
 * 捕获整个应用的 React 渲染错误，显示友好的错误页面并上报到 Sentry。
 * 应该包裹在 App 组件的最外层，确保能捕获所有子组件的错误。
 */
export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(
    error: Error
  ): Partial<GlobalErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[GlobalErrorBoundary] Fatal error caught:", error, errorInfo)

    // 存储 errorInfo 到 state（用于 UI 显示）
    this.setState({ errorInfo })

    // 上报到 Sentry（动态导入 + 错误处理）
    import("@sentry/electron/renderer")
      .then((Sentry) => {
        Sentry.captureException(error, {
          tags: {
            errorCategory: "ui-global-crash",
            errorBoundary: "global",
          },
          extra: {
            componentStack: errorInfo.componentStack,
            errorMessage: error.message,
            errorStack: error.stack,
            location: window.location.href,
            userAgent: navigator.userAgent,
            language: i18n.language || navigator.language,
            isDev: import.meta.env.DEV,
            timestamp: new Date().toISOString(),
          },
          level: "fatal",
        })
        console.log("[GlobalErrorBoundary] Error reported to Sentry")
      })
      .catch((sentryErr) => {
        // Dev 模式下 Sentry 未加载，只记录到控制台
        console.warn(
          "[GlobalErrorBoundary] Failed to report to Sentry:",
          sentryErr
        )
      })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallbackUI error={this.state.error} onReload={this.handleReload} />
      )
    }

    return this.props.children
  }
}
