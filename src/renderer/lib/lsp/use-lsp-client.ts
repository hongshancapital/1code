/**
 * LSP Client Hook
 *
 * Manages LSP connection lifecycle and provides methods for
 * interacting with the Language Server.
 */

import { useEffect, useCallback, useRef, useState, useMemo } from "react"
import { useAtomValue } from "jotai"
import type * as Monaco from "monaco-editor"
import { trpc, trpcClient } from "../trpc"
import { selectedProjectAtom } from "../atoms"
import { createLogger } from "../logger"

const lspLog = createLogger("LSP")


// Map Monaco language IDs to our LSP language types
function mapMonacoLanguage(
  monacoLang: string
): "typescript" | "javascript" | null {
  switch (monacoLang) {
    case "typescript":
    case "typescriptreact":
      return "typescript"
    case "javascript":
    case "javascriptreact":
      return "javascript"
    default:
      return null
  }
}

// Map tsserver completion kinds to Monaco completion kinds
function mapCompletionKind(
  tsKind: string,
  monaco: typeof Monaco
): Monaco.languages.CompletionItemKind {
  const kindMap: Record<string, Monaco.languages.CompletionItemKind> = {
    keyword: monaco.languages.CompletionItemKind.Keyword,
    function: monaco.languages.CompletionItemKind.Function,
    method: monaco.languages.CompletionItemKind.Method,
    property: monaco.languages.CompletionItemKind.Property,
    var: monaco.languages.CompletionItemKind.Variable,
    let: monaco.languages.CompletionItemKind.Variable,
    const: monaco.languages.CompletionItemKind.Constant,
    class: monaco.languages.CompletionItemKind.Class,
    interface: monaco.languages.CompletionItemKind.Interface,
    type: monaco.languages.CompletionItemKind.Interface,
    enum: monaco.languages.CompletionItemKind.Enum,
    "enum member": monaco.languages.CompletionItemKind.EnumMember,
    module: monaco.languages.CompletionItemKind.Module,
    file: monaco.languages.CompletionItemKind.File,
    directory: monaco.languages.CompletionItemKind.Folder,
    string: monaco.languages.CompletionItemKind.Value,
    text: monaco.languages.CompletionItemKind.Text,
  }
  return kindMap[tsKind] || monaco.languages.CompletionItemKind.Text
}

// Map tsserver diagnostic category to Monaco severity
function mapDiagnosticSeverity(
  category: string,
  monaco: typeof Monaco
): Monaco.MarkerSeverity {
  switch (category) {
    case "error":
      return monaco.MarkerSeverity.Error
    case "warning":
      return monaco.MarkerSeverity.Warning
    case "suggestion":
      return monaco.MarkerSeverity.Hint
    default:
      return monaco.MarkerSeverity.Info
  }
}

interface UseLSPClientOptions {
  filePath: string
  language: string
  enabled?: boolean
}

interface UseLSPClientResult {
  isConnected: boolean
  isConnecting: boolean
  error: string | null
  sendDidOpen: (content: string) => Promise<void>
  sendDidChange: (content: string) => Promise<void>
  sendDidClose: () => Promise<void>
  registerProviders: (
    monaco: typeof Monaco,
    editor: Monaco.editor.IStandaloneCodeEditor
  ) => () => void
}

export function useLSPClient({
  filePath,
  language,
  enabled = true,
}: UseLSPClientOptions): UseLSPClientResult {
  const project = useAtomValue(selectedProjectAtom)
  const sessionIdRef = useRef<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disposablesRef = useRef<Monaco.IDisposable[]>([])
  // Track if the file is open in tsserver
  const fileOpenRef = useRef(false)
  // Track the current file path to detect changes
  const currentFilePathRef = useRef<string | null>(null)

  // Map language to LSP language
  const lspLanguage = useMemo(() => mapMonacoLanguage(language), [language])

  // Check if LSP is supported for this language
  const isSupported = lspLanguage !== null && enabled

  // Reset file open state when file path changes
  useEffect(() => {
    if (currentFilePathRef.current !== filePath) {
      // File path changed, reset state
      if (currentFilePathRef.current !== null) {
        fileOpenRef.current = false
      }
      currentFilePathRef.current = filePath
    }
  }, [filePath])

  // Mutations
  const startMutation = trpc.lsp.start.useMutation()
  const openFileMutation = trpc.lsp.openFile.useMutation()
  const updateFileMutation = trpc.lsp.updateFile.useMutation()
  const closeFileMutation = trpc.lsp.closeFile.useMutation()

  // Generate session ID from project path
  const sessionId = useMemo(() => {
    if (!project?.path || !lspLanguage) return null
    return `${project.path}:${lspLanguage}`
  }, [project?.path, lspLanguage])

  // Initialize LSP connection
  const projectPath = project?.path
  useEffect(() => {
    if (!sessionId || !projectPath || !lspLanguage || !isSupported) {
      return
    }

    // Skip if already connected or connecting
    if (isConnected || isConnecting) {
      return
    }

    sessionIdRef.current = sessionId
    setIsConnecting(true)
    setError(null)

    const init = async () => {
      try {
        await startMutation.mutateAsync({
          sessionId,
          projectPath,
          config: {
            language: lspLanguage,
            backend: "tsserver", // TODO: Get from settings
          },
        })
        setIsConnected(true)
        lspLog.info(`[LSP Client] Connected to ${lspLanguage} server`)
      } catch (err) {
        lspLog.error("[LSP Client] Failed to start:", err)
        setError(err instanceof Error ? err.message : "Failed to connect")
        setIsConnected(false)
      } finally {
        setIsConnecting(false)
      }
    }

    init()

    return () => {
      // Don't stop the server on unmount - it's shared across files
      // The server will be stopped when the project is closed
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, projectPath, lspLanguage, isSupported])

  // Send didOpen notification
  const sendDidOpen = useCallback(
    async (content: string) => {
      if (!sessionIdRef.current || !isConnected) return
      // Skip if file is already open
      if (fileOpenRef.current) return

      try {
        await openFileMutation.mutateAsync({
          sessionId: sessionIdRef.current,
          filePath,
          content,
        })
        fileOpenRef.current = true
        lspLog.info(`[LSP Client] File opened: ${filePath}`)
      } catch (err) {
        lspLog.error("[LSP Client] Failed to open file:", err)
      }
    },
    [filePath, isConnected, openFileMutation]
  )

  // Send didChange notification
  const sendDidChange = useCallback(
    async (content: string) => {
      if (!sessionIdRef.current || !isConnected) return

      try {
        await updateFileMutation.mutateAsync({
          sessionId: sessionIdRef.current,
          filePath,
          content,
        })
      } catch (err) {
        lspLog.error("[LSP Client] Failed to update file:", err)
      }
    },
    [filePath, isConnected, updateFileMutation]
  )

  // Send didClose notification
  const sendDidClose = useCallback(async () => {
    if (!sessionIdRef.current) return
    // Skip if file is not open
    if (!fileOpenRef.current) return

    try {
      await closeFileMutation.mutateAsync({
        sessionId: sessionIdRef.current,
        filePath,
      })
      fileOpenRef.current = false
      lspLog.info(`[LSP Client] File closed: ${filePath}`)
    } catch (err) {
      lspLog.error("[LSP Client] Failed to close file:", err)
    }
  }, [filePath, closeFileMutation])

  // Register Monaco providers
  const registerProviders = useCallback(
    (
      monaco: typeof Monaco,
      editor: Monaco.editor.IStandaloneCodeEditor
    ): (() => void) => {
      if (!sessionIdRef.current || !isConnected) {
        return () => {}
      }

      const sessionId = sessionIdRef.current
      const model = editor.getModel()
      if (!model) return () => {}

      // Clean up previous disposables
      disposablesRef.current.forEach((d) => d.dispose())
      disposablesRef.current = []

      // Completion provider - use trpcClient (vanilla) for non-React context
      const completionProvider = monaco.languages.registerCompletionItemProvider(
        language,
        {
          triggerCharacters: [".", "/", "@", "<", '"', "'", "`", " "],

          async provideCompletionItems(model, position) {
            // Wait for file to be open in tsserver
            if (!fileOpenRef.current) {
              return { suggestions: [] }
            }

            try {
              const result = await trpcClient.lsp.completions.query({
                sessionId,
                filePath,
                position: {
                  line: position.lineNumber,
                  offset: position.column,
                },
              })

              const completions = result.completions || []

              // Get the word at position to create range
              const word = model.getWordUntilPosition(position)
              const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
              }

              return {
                suggestions: completions.map((item: any) => ({
                  label: item.name,
                  kind: mapCompletionKind(item.kind, monaco),
                  insertText: item.insertText || item.name,
                  detail: item.kindModifiers,
                  sortText: item.sortText,
                  filterText: item.name,
                  range,
                })),
              }
            } catch (err) {
              lspLog.error("Completion error:", err)
              return { suggestions: [] }
            }
          },
        }
      )
      disposablesRef.current.push(completionProvider)

      // Hover provider
      const hoverProvider = monaco.languages.registerHoverProvider(language, {
        async provideHover(_model, position) {
          // Wait for file to be open in tsserver
          if (!fileOpenRef.current) {
            return null
          }

          try {
            const result = await trpcClient.lsp.quickInfo.query({
              sessionId,
              filePath,
              position: {
                line: position.lineNumber,
                offset: position.column,
              },
            })

            const info = result.info
            if (!info) return null

            const contents: Monaco.IMarkdownString[] = []

            // Type information
            if (info.displayString) {
              contents.push({
                value: "```typescript\n" + info.displayString + "\n```",
              })
            }

            // Documentation
            if (info.documentation) {
              contents.push({ value: info.documentation })
            }

            // Tags
            if (info.tags?.length) {
              const tagsText = info.tags
                .map((tag: any) => `@${tag.name}${tag.text ? " " + tag.text : ""}`)
                .join("\n")
              contents.push({ value: tagsText })
            }

            return {
              contents,
              range: {
                startLineNumber: info.start?.line || position.lineNumber,
                startColumn: info.start?.offset || position.column,
                endLineNumber: info.end?.line || position.lineNumber,
                endColumn: info.end?.offset || position.column,
              },
            }
          } catch (err) {
            lspLog.error("Hover error:", err)
            return null
          }
        },
      })
      disposablesRef.current.push(hoverProvider)

      // Signature help provider
      const signatureProvider = monaco.languages.registerSignatureHelpProvider(
        language,
        {
          signatureHelpTriggerCharacters: ["(", ","],
          signatureHelpRetriggerCharacters: [","],

          async provideSignatureHelp(_model, position) {
            // Wait for file to be open in tsserver
            if (!fileOpenRef.current) {
              return null
            }

            try {
              const result = await trpcClient.lsp.signatureHelp.query({
                sessionId,
                filePath,
                position: {
                  line: position.lineNumber,
                  offset: position.column,
                },
              })

              const help = result.help
              if (!help?.items?.length) return null

              return {
                value: {
                  signatures: help.items.map((item: any) => ({
                    label:
                      item.prefixDisplayParts?.map((p: any) => p.text).join("") +
                      item.parameters
                        ?.map((p: any) =>
                          p.displayParts.map((d: any) => d.text).join("")
                        )
                        .join(", ") +
                      item.suffixDisplayParts?.map((p: any) => p.text).join(""),
                    documentation:
                      item.documentation?.map((d: any) => d.text).join("") || "",
                    parameters:
                      item.parameters?.map((p: any) => ({
                        label: p.displayParts.map((d: any) => d.text).join(""),
                        documentation:
                          p.documentation?.map((d: any) => d.text).join("") ||
                          "",
                      })) || [],
                  })),
                  activeSignature: help.selectedItemIndex || 0,
                  activeParameter: help.argumentIndex || 0,
                },
                dispose: () => {},
              }
            } catch (err) {
              lspLog.error("Signature help error:", err)
              return null
            }
          },
        }
      )
      disposablesRef.current.push(signatureProvider)

      // Definition provider
      const definitionProvider = monaco.languages.registerDefinitionProvider(
        language,
        {
          async provideDefinition(_model, position) {
            // Wait for file to be open in tsserver
            if (!fileOpenRef.current) {
              return null
            }

            try {
              const result = await trpcClient.lsp.definition.query({
                sessionId,
                filePath,
                position: {
                  line: position.lineNumber,
                  offset: position.column,
                },
              })

              const definitions = result.definitions || []
              if (!definitions.length) return null

              return definitions.map((def: any) => ({
                uri: monaco.Uri.file(def.file),
                range: {
                  startLineNumber: def.start?.line || 1,
                  startColumn: def.start?.offset || 1,
                  endLineNumber: def.end?.line || 1,
                  endColumn: def.end?.offset || 1,
                },
              }))
            } catch (err) {
              lspLog.error("Definition error:", err)
              return null
            }
          },
        }
      )
      disposablesRef.current.push(definitionProvider)

      // References provider
      const referencesProvider = monaco.languages.registerReferenceProvider(
        language,
        {
          async provideReferences(_model, position, _context) {
            // Wait for file to be open in tsserver
            if (!fileOpenRef.current) {
              return null
            }

            try {
              const result = await trpcClient.lsp.references.query({
                sessionId,
                filePath,
                position: {
                  line: position.lineNumber,
                  offset: position.column,
                },
              })

              const references = result.references || []
              if (!references.length) return null

              return references.map((ref: any) => ({
                uri: monaco.Uri.file(ref.file),
                range: {
                  startLineNumber: ref.start?.line || 1,
                  startColumn: ref.start?.offset || 1,
                  endLineNumber: ref.end?.line || 1,
                  endColumn: ref.end?.offset || 1,
                },
              }))
            } catch (err) {
              lspLog.error("References error:", err)
              return null
            }
          },
        }
      )
      disposablesRef.current.push(referencesProvider)

      // Request initial diagnostics
      const updateDiagnostics = async () => {
        // Wait for file to be open in tsserver
        if (!fileOpenRef.current) {
          return
        }

        try {
          const result = await trpcClient.lsp.diagnostics.query({
            sessionId,
            filePath,
          })

          const diagnostics = result.diagnostics || []
          const markers: Monaco.editor.IMarkerData[] = diagnostics.map(
            (diag: any) => ({
              severity: mapDiagnosticSeverity(diag.category, monaco),
              message: diag.text,
              startLineNumber: diag.start?.line || 1,
              startColumn: diag.start?.offset || 1,
              endLineNumber: diag.end?.line || 1,
              endColumn: diag.end?.offset || 1,
              code: diag.code?.toString(),
              source: "ts",
            })
          )

          monaco.editor.setModelMarkers(model, "lsp", markers)
        } catch (err) {
          lspLog.error("Diagnostics error:", err)
        }
      }

      // Update diagnostics on content change (debounced)
      let diagnosticsTimeout: NodeJS.Timeout | null = null
      const onContentChange = model.onDidChangeContent(() => {
        if (diagnosticsTimeout) {
          clearTimeout(diagnosticsTimeout)
        }
        diagnosticsTimeout = setTimeout(updateDiagnostics, 500)
      })
      disposablesRef.current.push(onContentChange)

      // Initial diagnostics
      updateDiagnostics()

      // Cleanup function
      return () => {
        if (diagnosticsTimeout) {
          clearTimeout(diagnosticsTimeout)
        }
        disposablesRef.current.forEach((d) => d.dispose())
        disposablesRef.current = []
        monaco.editor.setModelMarkers(model, "lsp", [])
      }
    },
    [language, filePath, isConnected]
  )

  return {
    isConnected,
    isConnecting,
    error,
    sendDidOpen,
    sendDidChange,
    sendDidClose,
    registerProviders,
  }
}
