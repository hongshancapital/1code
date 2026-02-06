"use client"

import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog"
import { Sparkles, Calendar } from "lucide-react"
import type { InsightReport } from "../../../main/lib/insights/types"

interface InsightDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: InsightReport | null | undefined
}

export function InsightDetailDialog({
  open,
  onOpenChange,
  report,
}: InsightDetailDialogProps) {
  const { t } = useTranslation("home")

  if (!report) return null

  const reportTypeLabel = report.reportType === "daily"
    ? t("insights.daily")
    : t("insights.weekly")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[600px] max-w-[90vw] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <DialogTitle>{t("insights.detailTitle")}</DialogTitle>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <Calendar className="h-3.5 w-3.5" />
            <span>{reportTypeLabel} · {report.reportDate}</span>
          </div>
        </DialogHeader>

        {/* 报告内容 - 可滚动 */}
        <div className="flex-1 overflow-y-auto pr-2 -mr-2">
          {report.reportHtml ? (
            <div
              className="insight-report-content prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: report.reportHtml }}
            />
          ) : report.reportMarkdown ? (
            <SimpleMarkdownRenderer content={report.reportMarkdown} />
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("insights.noContent")}
            </p>
          )}
        </div>
      </DialogContent>

      {/* 报告样式 */}
      <style>{`
        .insight-report-content {
          font-size: 14px;
          line-height: 1.6;
        }

        .insight-report-content h2 {
          font-size: 16px;
          font-weight: 600;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
          color: hsl(var(--foreground));
        }

        .insight-report-content h2:first-child {
          margin-top: 0;
        }

        .insight-report-content section {
          margin-bottom: 1.5rem;
        }

        .insight-report-content section:last-child {
          margin-bottom: 0;
        }

        .insight-report-content p {
          color: hsl(var(--muted-foreground));
          margin-bottom: 0.5rem;
        }

        .insight-report-content ul {
          list-style-type: disc;
          padding-left: 1.25rem;
          color: hsl(var(--muted-foreground));
        }

        .insight-report-content li {
          margin-bottom: 0.25rem;
        }

        .insight-report-content .highlight {
          background: hsl(var(--primary) / 0.05);
          border-radius: 8px;
          padding: 1rem;
          border-left: 3px solid hsl(var(--primary));
        }

        .insight-report-content .encouragement {
          background: hsl(var(--chart-2) / 0.1);
          border-radius: 8px;
          padding: 1rem;
        }

        .insight-report-content .next-steps {
          background: hsl(var(--muted) / 0.5);
          border-radius: 8px;
          padding: 1rem;
        }

        .insight-report-content strong {
          color: hsl(var(--foreground));
          font-weight: 600;
        }
      `}</style>
    </Dialog>
  )
}

/**
 * 简单的 Markdown 渲染器（备用）
 */
function SimpleMarkdownRenderer({ content }: { content: string }) {
  const lines = content.split("\n")

  return (
    <div className="space-y-2 text-sm">
      {lines.map((line, index) => {
        if (line.startsWith("## ")) {
          return (
            <h2 key={index} className="text-base font-semibold mt-4 mb-2 first:mt-0">
              {line.slice(3)}
            </h2>
          )
        }
        if (line.startsWith("# ")) {
          return (
            <h1 key={index} className="text-lg font-semibold mt-4 mb-2 first:mt-0">
              {line.slice(2)}
            </h1>
          )
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <li key={index} className="text-muted-foreground ml-4 list-disc">
              {renderInline(line.slice(2))}
            </li>
          )
        }
        if (line.trim() === "") {
          return <div key={index} className="h-2" />
        }
        return (
          <p key={index} className="text-muted-foreground">
            {renderInline(line)}
          </p>
        )
      })}
    </div>
  )
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-medium text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return part
  })
}
