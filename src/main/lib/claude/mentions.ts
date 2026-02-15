/**
 * @mention 解析 + Artifact 追踪
 *
 * 从 claude.ts 提取的纯函数模块，处理：
 * - @[agent:name], @[skill:name], @[tool:name] 解析
 * - diff-code / quote mention 转换
 * - 文件/文件夹 mention 路径解析
 * - Artifact context 提取（Read/Glob/Grep/WebFetch/WebSearch）
 * - 代码文件扩展名判断（是否追踪为 artifact）
 */

// UTF-8 safe base64 decoding (atob doesn't support Unicode)
function base64ToUtf8(base64: string): string {
  try {
    const binString = atob(base64);
    const bytes = Uint8Array.from(binString, (char) => char.codePointAt(0)!);
    return new TextDecoder().decode(bytes);
  } catch {
    return base64; // Return original if decode fails
  }
}

/**
 * Parse a diff mention and convert to readable format
 * Format: diff-code:filepath:lineNumber:preview:base64_full_text:base64_comment
 */
function parseDiffMention(content: string): {
  text: string;
  hasComment: boolean;
} {
  const parts = content.split(":");
  if (parts.length < 4) {
    return { text: content, hasComment: false };
  }

  const filePath = parts[0] || "";
  const lineNumber = parts[1] || "";
  // parts[2] is preview (not needed, we use full text)
  const encodedText = parts[3] || "";
  const encodedComment = parts[4] || "";

  let fullText = "";
  try {
    if (encodedText) {
      fullText = base64ToUtf8(encodedText);
    }
  } catch {
    fullText = parts[2] || ""; // Fallback to preview
  }

  let comment = "";
  try {
    if (encodedComment) {
      comment = base64ToUtf8(encodedComment);
    }
  } catch {
    // Ignore decode errors for comment
  }

  const fileName = filePath.split("/").pop() || filePath;
  const lineInfo =
    lineNumber && lineNumber !== "0" ? ` (line ${lineNumber})` : "";

  if (comment) {
    return {
      text: `[Code Review Comment on ${fileName}${lineInfo}]\nUser's comment: "${comment}"\nReferenced code:\n\`\`\`\n${fullText}\n\`\`\``,
      hasComment: true,
    };
  } else {
    return {
      text: `[Code Reference from ${fileName}${lineInfo}]\n\`\`\`\n${fullText}\n\`\`\``,
      hasComment: false,
    };
  }
}

/**
 * Parse a quote mention and convert to readable format
 * Format: quote:preview:base64_full_text
 */
function parseQuoteMention(content: string): string {
  const separatorIdx = content.indexOf(":");
  if (separatorIdx === -1) {
    return `[Quoted text]\n"${content}"`;
  }

  const encodedText = content.slice(separatorIdx + 1);
  let fullText = content.slice(0, separatorIdx); // Default to preview
  try {
    if (encodedText) {
      fullText = base64ToUtf8(encodedText);
    }
  } catch {
    // Keep preview as fallback
  }

  return `[Quoted text]\n"${fullText}"`;
}

/**
 * Parse @[agent:name], @[skill:name], and @[tool:name] mentions from prompt text
 * Returns the cleaned prompt and lists of mentioned agents/skills/tools
 *
 * File mention formats:
 * - @[file:local:relative/path] - file inside project (relative path)
 * - @[file:external:/absolute/path] - file outside project (absolute path)
 * - @[file:owner/repo:path] - legacy web format (repo:path)
 * - @[folder:local:path] or @[folder:external:path] - folder mentions
 */
export function parseMentions(prompt: string): {
  cleanedPrompt: string;
  agentMentions: string[];
  skillMentions: string[];
  fileMentions: string[];
  folderMentions: string[];
  toolMentions: string[];
} {
  const agentMentions: string[] = [];
  const skillMentions: string[] = [];
  const fileMentions: string[] = [];
  const folderMentions: string[] = [];
  const toolMentions: string[] = [];

  // Match @[prefix:name] pattern
  const mentionRegex = /@\[(file|folder|skill|agent|tool):([^\]]+)\]/g;
  let match;

  while ((match = mentionRegex.exec(prompt)) !== null) {
    const [, type, name] = match;
    switch (type) {
      case "agent":
        agentMentions.push(name);
        break;
      case "skill":
        skillMentions.push(name);
        break;
      case "file":
        fileMentions.push(name);
        break;
      case "folder":
        folderMentions.push(name);
        break;
      case "tool":
        // Validate: server name (alphanumeric, underscore, hyphen) or full tool id (mcp__server__tool)
        if (
          /^[a-zA-Z0-9_-]+$/.test(name) ||
          /^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/.test(name)
        ) {
          toolMentions.push(name);
        }
        break;
    }
  }

  // Clean agent/skill/tool mentions from prompt (they will be added as context or hints)
  // Keep file/folder mentions as they are useful context
  let cleanedPrompt = prompt
    .replace(/@\[agent:[^\]]+\]/g, "")
    .replace(/@\[skill:[^\]]+\]/g, "")
    .replace(/@\[tool:[^\]]+\]/g, "");

  // Convert diff-code mentions to readable format with code review comments
  const diffMentionRegex = /@\[diff-code:([^\]]+)\]/g;
  const diffContexts: string[] = [];
  cleanedPrompt = cleanedPrompt.replace(diffMentionRegex, (_, content) => {
    const { text } = parseDiffMention(content);
    diffContexts.push(text);
    return ""; // Remove from main text, will be prepended as context
  });

  // Convert quote mentions to readable format
  const quoteMentionRegex = /@\[quote:([^\]]+)\]/g;
  const quoteContexts: string[] = [];
  cleanedPrompt = cleanedPrompt.replace(quoteMentionRegex, (_, content) => {
    const text = parseQuoteMention(content);
    quoteContexts.push(text);
    return ""; // Remove from main text, will be prepended as context
  });

  cleanedPrompt = cleanedPrompt.trim();

  // Prepend code review comments and quotes as context
  const contextParts: string[] = [];
  if (diffContexts.length > 0) {
    contextParts.push(diffContexts.join("\n\n"));
  }
  if (quoteContexts.length > 0) {
    contextParts.push(quoteContexts.join("\n\n"));
  }

  if (contextParts.length > 0) {
    cleanedPrompt = `${contextParts.join("\n\n")}\n\n${cleanedPrompt}`;
  }

  // Transform file mentions to readable paths for the agent
  // @[file:local:path] -> path (relative to project)
  // @[file:external:/abs/path] -> /abs/path (absolute)
  cleanedPrompt = cleanedPrompt
    .replace(/@\[file:local:([^\]]+)\]/g, "$1")
    .replace(/@\[file:external:([^\]]+)\]/g, "$1")
    .replace(/@\[folder:local:([^\]]+)\]/g, "$1")
    .replace(/@\[folder:external:([^\]]+)\]/g, "$1");

  // Add usage hints for mentioned MCP servers or individual tools
  // Names are already validated to contain only safe characters
  if (toolMentions.length > 0) {
    const toolHints = toolMentions
      .map((t) => {
        if (t.startsWith("mcp__")) {
          // Individual tool mention (from MCP widget): "Use the mcp__server__tool tool"
          return `Use the ${t} tool for this request.`;
        }
        // Server mention (from @ dropdown): "Use tools from the X MCP server"
        return `Use tools from the ${t} MCP server for this request.`;
      })
      .join(" ");
    cleanedPrompt = `${toolHints}\n\n${cleanedPrompt}`;
  }

  return {
    cleanedPrompt,
    agentMentions,
    skillMentions,
    fileMentions,
    folderMentions,
    toolMentions,
  };
}

/**
 * Code file extensions that should NOT be tracked as artifacts (deliverables).
 * These are source code files that are intermediate work products, not final outputs.
 * Note: HTML is intentionally NOT in this list - it's a deliverable format.
 */
const CODE_FILE_EXTENSIONS = new Set([
  // JavaScript/TypeScript
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts",
  // Python
  ".py", ".pyw", ".pyi", ".pyc", ".pyo",
  // Java/Kotlin/Scala
  ".java", ".kt", ".kts", ".scala", ".sc",
  // C/C++/Objective-C
  ".c", ".h", ".cpp", ".hpp", ".cc", ".cxx", ".hxx", ".m", ".mm",
  // C#/F#
  ".cs", ".fs", ".fsx",
  // Go
  ".go",
  // Rust
  ".rs",
  // Ruby
  ".rb", ".rake", ".gemspec",
  // PHP
  ".php", ".phtml", ".php3", ".php4", ".php5", ".phps",
  // Swift
  ".swift",
  // Shell/Scripts
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".bat", ".cmd",
  // Lua
  ".lua",
  // Perl
  ".pl", ".pm", ".t",
  // R
  ".r", ".R", ".rmd", ".Rmd",
  // Julia
  ".jl",
  // Haskell
  ".hs", ".lhs",
  // Elixir/Erlang
  ".ex", ".exs", ".erl", ".hrl",
  // Clojure
  ".clj", ".cljs", ".cljc", ".edn",
  // Vue/Svelte (component files)
  ".vue", ".svelte",
  // Config/Definition files (these are code-like)
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  // CSS/Style files
  ".css", ".scss", ".sass", ".less", ".styl",
  // GraphQL
  ".graphql", ".gql",
  // SQL
  ".sql",
  // WebAssembly
  ".wasm", ".wat",
  // Assembly
  ".asm", ".s",
]);

/**
 * Check if a file should be tracked as an artifact (deliverable).
 * Code files are excluded - they can still appear in contexts but not as primary artifacts.
 * HTML files are considered deliverables and are included.
 */
export function shouldTrackAsArtifact(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return !CODE_FILE_EXTENSIONS.has(ext);
}

/**
 * Artifact context type - represents files or URLs used as context for an artifact
 */
export interface ArtifactContext {
  type: "file" | "url";
  filePath?: string;
  toolType?: "Read" | "Glob" | "Grep";
  url?: string;
  title?: string;
}

/**
 * Extract artifact contexts from message parts
 * Collects all Read/Glob/Grep/WebFetch/WebSearch tool calls that preceded Write/Edit
 */
export function extractArtifactContexts(parts: any[]): ArtifactContext[] {
  const contexts: ArtifactContext[] = [];
  const seenFiles = new Set<string>();
  const seenUrls = new Set<string>();

  for (const part of parts) {
    // File read
    if (
      part.type === "tool-Read" &&
      part.input?.file_path &&
      part.state === "result"
    ) {
      const filePath = part.input.file_path;
      if (!seenFiles.has(filePath)) {
        seenFiles.add(filePath);
        contexts.push({
          type: "file",
          filePath,
          toolType: "Read",
        });
      }
    }

    // File search (Glob) - extract matched files from output
    if (part.type === "tool-Glob" && part.state === "result") {
      const files = Array.isArray(part.output) ? part.output : [];
      for (const file of files.slice(0, 10)) {
        // Limit to 10 files
        if (typeof file === "string" && !seenFiles.has(file)) {
          seenFiles.add(file);
          contexts.push({
            type: "file",
            filePath: file,
            toolType: "Glob",
          });
        }
      }
    }

    // Content search (Grep)
    if (
      part.type === "tool-Grep" &&
      part.input?.path &&
      part.state === "result"
    ) {
      const filePath = part.input.path;
      if (!seenFiles.has(filePath)) {
        seenFiles.add(filePath);
        contexts.push({
          type: "file",
          filePath,
          toolType: "Grep",
        });
      }
    }

    // Web fetch
    if (
      part.type === "tool-WebFetch" &&
      part.input?.url &&
      part.state === "result"
    ) {
      const url = part.input.url;
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        contexts.push({
          type: "url",
          url,
        });
      }
    }

    // Web search - extract URLs from output if available
    if (part.type === "tool-WebSearch" && part.state === "result") {
      // WebSearch output structure may vary, try to extract URLs
      const output = part.output;
      if (output && typeof output === "object") {
        // Handle array of results
        const results = Array.isArray(output) ? output : output.results || [];
        for (const result of results.slice(0, 5)) {
          // Limit to 5 URLs
          const url = result.url || result.link;
          if (url && typeof url === "string" && !seenUrls.has(url)) {
            seenUrls.add(url);
            contexts.push({
              type: "url",
              url,
              title: result.title,
            });
          }
        }
      }
    }
  }

  return contexts;
}
