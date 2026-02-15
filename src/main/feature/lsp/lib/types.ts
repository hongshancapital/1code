/**
 * LSP Types and Interfaces
 */

// Supported LSP languages
export type LSPLanguage = "typescript" | "javascript"

// Backend types for each language
export type TypeScriptBackend = "tsserver" | "tsgo"

// LSP session configuration
export interface LSPConfig {
  language: LSPLanguage
  backend: TypeScriptBackend
  customPath?: string // Custom path for tsgo binary
}

// LSP session state
export interface LSPSession {
  id: string
  projectPath: string
  config: LSPConfig
  isAlive: boolean
  requestId: number
  pendingRequests: Map<number, {
    resolve: (value: any) => void
    reject: (error: any) => void
    command: string
  }>
}

// tsserver request/response types
export interface TsServerRequest {
  seq: number
  type: "request"
  command: string
  arguments?: Record<string, any>
}

export interface TsServerResponse {
  seq: number
  type: "response" | "event"
  command?: string
  request_seq?: number
  success?: boolean
  message?: string
  body?: any
}

export interface TsServerEvent {
  seq: number
  type: "event"
  event: string
  body?: any
}

// Position in file (1-based for tsserver)
export interface FilePosition {
  line: number
  offset: number
}

// Completion item from tsserver
export interface CompletionEntry {
  name: string
  kind: string
  kindModifiers?: string
  sortText?: string
  insertText?: string
  replacementSpan?: {
    start: FilePosition
    end: FilePosition
  }
  hasAction?: boolean
  source?: string
  isRecommended?: boolean
  isFromUncheckedFile?: boolean
}

// Quick info (hover) from tsserver
export interface QuickInfo {
  kind: string
  kindModifiers: string
  start: FilePosition
  end: FilePosition
  displayString: string
  documentation: string
  tags?: Array<{
    name: string
    text?: string
  }>
}

// Diagnostic from tsserver
export interface Diagnostic {
  start: FilePosition
  end: FilePosition
  text: string
  code: number
  category: "error" | "warning" | "suggestion" | "message"
  reportsUnnecessary?: boolean
  reportsDeprecated?: boolean
  relatedInformation?: Array<{
    span: {
      start: FilePosition
      end: FilePosition
      file: string
    }
    message: string
  }>
}

// Definition location
export interface DefinitionInfo {
  file: string
  start: FilePosition
  end: FilePosition
  contextStart?: FilePosition
  contextEnd?: FilePosition
}

// Reference location
export interface ReferenceEntry {
  file: string
  start: FilePosition
  end: FilePosition
  isDefinition: boolean
  isInString?: boolean
  isWriteAccess?: boolean
}
