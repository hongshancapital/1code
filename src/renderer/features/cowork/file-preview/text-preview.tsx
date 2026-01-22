import { useEffect, useState } from "react"
import { codeToHtml } from "shiki"
import { cn } from "../../../lib/utils"
import { Loader2 } from "lucide-react"

interface TextPreviewProps {
  content: string
  fileName: string
  className?: string
}

// Map file extensions to Shiki language identifiers
function getLanguageFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || ""

  const langMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    mjs: "javascript",
    cjs: "javascript",

    // Web
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    vue: "vue",
    svelte: "svelte",

    // Data formats
    json: "json",
    jsonc: "jsonc",
    json5: "json5",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    csv: "csv",

    // Shell/Scripts
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "fish",
    ps1: "powershell",
    bat: "batch",
    cmd: "batch",

    // Python
    py: "python",
    pyw: "python",
    pyi: "python",
    ipynb: "python",

    // Other languages
    rb: "ruby",
    php: "php",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    swift: "swift",
    go: "go",
    rs: "rust",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    fs: "fsharp",
    scala: "scala",
    clj: "clojure",
    ex: "elixir",
    exs: "elixir",
    erl: "erlang",
    hs: "haskell",
    lua: "lua",
    r: "r",
    jl: "julia",
    dart: "dart",
    zig: "zig",
    nim: "nim",
    v: "v",
    d: "d",
    ml: "ocaml",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",

    // Config files
    dockerfile: "dockerfile",
    makefile: "makefile",
    cmake: "cmake",
    gradle: "groovy",
    tf: "hcl",
    hcl: "hcl",
    ini: "ini",
    conf: "ini",
    env: "shell",
    gitignore: "gitignore",
    editorconfig: "ini",

    // Markdown/Docs
    md: "markdown",
    mdx: "mdx",
    rst: "rst",
    tex: "latex",
    adoc: "asciidoc",

    // Misc
    diff: "diff",
    patch: "diff",
    log: "log",
    txt: "text",
  }

  // Handle special filenames
  const specialFiles: Record<string, string> = {
    Dockerfile: "dockerfile",
    Makefile: "makefile",
    CMakeLists: "cmake",
    Gemfile: "ruby",
    Rakefile: "ruby",
    Podfile: "ruby",
    Fastfile: "ruby",
    Vagrantfile: "ruby",
    Brewfile: "ruby",
  }

  const baseName = fileName.split("/").pop() || fileName
  if (specialFiles[baseName]) {
    return specialFiles[baseName]
  }

  return langMap[ext] || "text"
}

export function TextPreview({ content, fileName, className }: TextPreviewProps) {
  const [html, setHtml] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function highlight() {
      setIsLoading(true)
      setError(null)

      try {
        const lang = getLanguageFromFileName(fileName)
        const result = await codeToHtml(content, {
          lang,
          theme: "github-dark-default",
        })

        if (!cancelled) {
          setHtml(result)
        }
      } catch (err) {
        console.error("Syntax highlighting error:", err)
        if (!cancelled) {
          // Fallback to plain text
          setHtml(
            `<pre class="shiki"><code>${content
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")}</code></pre>`
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    highlight()

    return () => {
      cancelled = true
    }
  }, [content, fileName])

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn("flex items-center justify-center h-full text-destructive", className)}>
        {error}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "h-full overflow-auto text-sm [&_pre]:p-4 [&_pre]:m-0 [&_pre]:min-h-full [&_pre]:bg-transparent [&_code]:font-mono [&_code]:text-[13px] [&_code]:leading-relaxed",
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
