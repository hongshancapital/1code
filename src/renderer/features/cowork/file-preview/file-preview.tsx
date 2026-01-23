import { useMemo } from "react"
import { FileQuestion, Loader2 } from "lucide-react"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"
import { TextPreview } from "./text-preview"
import { MarkdownPreview } from "./markdown-preview"
import { ImagePreview } from "./image-preview"
import { PdfPreview } from "./pdf-preview"
import { VideoPreview } from "./video-preview"
import { AudioPreview } from "./audio-preview"
import { WordPreview } from "./word-preview"
import { ExcelPreview } from "./excel-preview"
import { PptPreview } from "./ppt-preview"
import { HtmlPreview } from "./html-preview"

interface FilePreviewProps {
  filePath: string
  className?: string
}

type FileType = "text" | "markdown" | "html" | "image" | "pdf" | "video" | "audio" | "word" | "excel" | "ppt" | "unsupported"

// Determine file type from extension
function getFileType(fileName: string): FileType {
  const ext = fileName.split(".").pop()?.toLowerCase() || ""

  // Markdown files
  if (["md", "mdx", "markdown"].includes(ext)) {
    return "markdown"
  }

  // HTML files
  if (["html", "htm"].includes(ext)) {
    return "html"
  }

  // Image files
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif", "tiff", "heic", "heif"].includes(ext)) {
    return "image"
  }

  // PDF files
  if (ext === "pdf") {
    return "pdf"
  }

  // Video files
  if (["mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv", "3gp"].includes(ext)) {
    return "video"
  }

  // Audio files
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac", "wma", "opus", "aiff"].includes(ext)) {
    return "audio"
  }

  // Word documents
  if (["docx", "doc"].includes(ext)) {
    return "word"
  }

  // Excel spreadsheets
  if (["xlsx", "xls", "xlsm", "xlsb"].includes(ext)) {
    return "excel"
  }

  // PowerPoint presentations
  if (["pptx", "ppt"].includes(ext)) {
    return "ppt"
  }

  // Text/code files
  const textExtensions = [
    // JavaScript/TypeScript
    "js", "jsx", "ts", "tsx", "mjs", "cjs",
    // Web
    "css", "scss", "sass", "less", "vue", "svelte",
    // Data formats
    "json", "jsonc", "json5", "yaml", "yml", "toml", "xml", "csv",
    // Shell/Scripts
    "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
    // Python
    "py", "pyw", "pyi",
    // Other languages
    "rb", "php", "java", "kt", "kts", "swift", "go", "rs",
    "c", "h", "cpp", "cc", "cxx", "hpp", "cs", "fs",
    "scala", "clj", "ex", "exs", "erl", "hs", "lua",
    "r", "jl", "dart", "zig", "nim", "v", "d", "ml",
    "sql", "graphql", "gql",
    // Config files
    "dockerfile", "makefile", "cmake", "gradle", "tf", "hcl",
    "ini", "conf", "env", "gitignore", "editorconfig",
    // Docs
    "rst", "tex", "adoc",
    // Misc
    "diff", "patch", "log", "txt",
  ]

  if (textExtensions.includes(ext)) {
    return "text"
  }

  // Check for common text file names without extensions
  const baseName = fileName.split("/").pop()?.toLowerCase() || ""
  const textFileNames = [
    "dockerfile", "makefile", "cmakelists", "gemfile", "rakefile",
    "podfile", "fastfile", "vagrantfile", "brewfile", "readme",
    "license", "changelog", "contributing", "authors", "todo",
  ]

  if (textFileNames.some((name) => baseName.startsWith(name))) {
    return "text"
  }

  return "unsupported"
}

export function FilePreview({ filePath, className }: FilePreviewProps) {
  const fileName = filePath.split("/").pop() || filePath
  const fileType = useMemo(() => getFileType(fileName), [fileName])

  // Read file content for text-based previews only
  const { data: content, isLoading, error } = trpc.files.readFile.useQuery(
    { path: filePath },
    {
      enabled: fileType === "text" || fileType === "markdown" || fileType === "html",
      staleTime: 30000,
    }
  )

  // Loading state (only for text-based files that need tRPC)
  if (isLoading && (fileType === "text" || fileType === "markdown" || fileType === "html")) {
    return (
      <div className={cn("h-full flex items-center justify-center", className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Error state (only for text-based files)
  if (error && (fileType === "text" || fileType === "markdown" || fileType === "html")) {
    return (
      <div className={cn("h-full flex flex-col items-center justify-center gap-2 text-destructive", className)}>
        <FileQuestion className="h-8 w-8 opacity-60" />
        <p className="text-sm">无法读取文件</p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    )
  }

  // Render appropriate preview based on file type
  switch (fileType) {
    case "markdown":
      return <MarkdownPreview content={content || ""} className={className} />

    case "html":
      return <HtmlPreview content={content || ""} fileName={fileName} className={className} />

    case "text":
      return <TextPreview content={content || ""} fileName={fileName} className={className} />

    case "image":
      return <ImagePreview filePath={filePath} className={className} />

    case "pdf":
      return <PdfPreview filePath={filePath} className={className} />

    case "video":
      return <VideoPreview filePath={filePath} className={className} />

    case "audio":
      return <AudioPreview filePath={filePath} className={className} />

    case "word":
      return <WordPreview filePath={filePath} className={className} />

    case "excel":
      return <ExcelPreview filePath={filePath} className={className} />

    case "ppt":
      return <PptPreview filePath={filePath} className={className} />

    case "unsupported":
    default:
      return (
        <div className={cn("h-full flex flex-col items-center justify-center gap-3 text-muted-foreground", className)}>
          <FileQuestion className="h-12 w-12 opacity-40" />
          <p className="text-sm">不支持预览此文件类型</p>
          <p className="text-xs text-muted-foreground/60">{fileName}</p>
        </div>
      )
  }
}
