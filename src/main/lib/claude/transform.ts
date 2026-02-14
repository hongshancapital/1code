import type {
  MCPServer,
  MCPServerStatus,
  MessageMetadata,
  UIMessageChunk,
} from "./types";

export function createTransformer(options?: {
  emitSdkMessageUuid?: boolean;
  isUsingOllama?: boolean;
}) {
  const emitSdkMessageUuid = options?.emitSdkMessageUuid === true;
  const isUsingOllama = options?.isUsingOllama === true;
  let textId: string | null = null;
  let textStarted = false;
  let started = false;
  let startTime: number | null = null;

  // Track streaming tool calls
  let currentToolCallId: string | null = null;
  let currentToolName: string | null = null;
  let currentToolOriginalId: string | null = null; // Original tool ID before composite
  let accumulatedToolInput = "";

  // Track already emitted tool IDs to avoid duplicates
  // (tools can come via streaming AND in the final assistant message)
  const emittedToolIds = new Set<string>();

  // Track the last text block ID for final response marking
  // This is used to identify when there's a "final text" response after tools
  let lastTextId: string | null = null;

  // Track parent tool context for nested tools (e.g., Explore agent)
  let currentParentToolUseId: string | null = null;

  // Map original toolCallId -> composite toolCallId (for tool-result matching)
  const toolIdMapping = new Map<string, string>();

  // Map toolCallId -> Bash command (for background task naming)
  const bashCommandMapping = new Map<string, string>();

  // Track compacting system tool for matching status->boundary events
  let lastCompactId: string | null = null;
  let compactCounter = 0;

  // Track streaming thinking for Extended Thinking
  let currentThinkingId: string | null = null;
  let inThinkingBlock = false; // Track if we're currently in a thinking block

  // Track per-API-call token usage from streaming events for accurate context estimation.
  // SDK's result.usage is cumulative across ALL API calls in the agentic loop,
  // but message_start/message_delta events contain per-call values.
  // The LAST API call's input_tokens is the actual context window size.
  let lastApiCallInputTokens = 0;
  let lastApiCallOutputTokens = 0;

  // Helper to create composite toolCallId: "parentId:childId" or just "childId"
  const makeCompositeId = (
    originalId: string,
    parentId: string | null,
  ): string => {
    if (parentId) return `${parentId}:${originalId}`;
    return originalId;
  };

  const genId = () =>
    `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Helper to end current text block
  function* endTextBlock(): Generator<UIMessageChunk> {
    if (textStarted && textId) {
      yield { type: "text-end", id: textId };
      // Track the last text ID for final response marking
      lastTextId = textId;
      textStarted = false;
      textId = null;
    }
  }

  // Helper to end current tool input
  function* endToolInput(): Generator<UIMessageChunk> {
    if (currentToolCallId) {
      // Track this tool ID to avoid duplicates from assistant message
      emittedToolIds.add(currentToolCallId);

      let parsedInput: Record<string, unknown> = {};
      if (accumulatedToolInput) {
        try {
          parsedInput = JSON.parse(accumulatedToolInput);
        } catch (e) {
          // Stream may have been interrupted mid-JSON (e.g. network error, abort)
          // resulting in incomplete JSON like '{"prompt":"write co'
          console.error(
            "[transform] Failed to parse tool input JSON:",
            (e as Error).message,
            "partial:",
            accumulatedToolInput.slice(0, 120),
          );
          parsedInput = { _raw: accumulatedToolInput, _parseError: true };
        }
      }

      // Store Bash command for background task naming (streaming mode)
      // Use original ID (not compositeId) since tool result uses original ID
      if (
        currentToolName === "Bash" &&
        parsedInput.command &&
        currentToolOriginalId
      ) {
        bashCommandMapping.set(
          currentToolOriginalId,
          parsedInput.command as string,
        );
      }

      // Emit complete tool call with accumulated input
      yield {
        type: "tool-input-available",
        toolCallId: currentToolCallId,
        toolName: currentToolName || "unknown",
        input: parsedInput,
      };
      currentToolCallId = null;
      currentToolName = null;
      currentToolOriginalId = null;
      accumulatedToolInput = "";
    }
  }

  return function* transform(msg: any): Generator<UIMessageChunk> {
    // Debug: log ALL message types to understand what SDK sends
    if (isUsingOllama) {
      console.log(
        "[Ollama Transform] MSG:",
        msg.type,
        msg.subtype || "",
        msg.event?.type || "",
      );
      if (msg.type === "system") {
        console.log(
          "[Ollama Transform] SYSTEM message full:",
          JSON.stringify(msg, null, 2),
        );
      }
      if (msg.type === "stream_event") {
        console.log(
          "[Ollama Transform] STREAM_EVENT:",
          msg.event?.type,
          "content_block:",
          msg.event?.content_block?.type,
        );
      }
      if (msg.type === "assistant") {
        console.log(
          "[Ollama Transform] ASSISTANT message, content blocks:",
          msg.message?.content?.length || 0,
        );
      }
    } else {
      console.log(
        "[transform] MSG:",
        msg.type,
        msg.subtype || "",
        msg.event?.type || "",
      );
      if (msg.type === "system") {
        console.log("[transform] SYSTEM message:", msg.subtype, msg);
      }
    }

    // Track parent_tool_use_id for nested tools
    // Only update when explicitly present (don't reset on messages without it)
    if (msg.parent_tool_use_id !== undefined) {
      currentParentToolUseId = msg.parent_tool_use_id;
    }

    // Emit start once
    if (!started) {
      started = true;
      startTime = Date.now();
      yield { type: "start" };
      yield { type: "start-step" };
    }

    // Reset thinking state on new message start to prevent memory leaks
    if (msg.type === "stream_event" && msg.event?.type === "message_start") {
      currentThinkingId = null;
      inThinkingBlock = false;

      // Capture per-API-call input tokens from message_start.
      // Each message_start in the agentic loop contains the ACTUAL input tokens
      // for that specific API call (= current context window size).
      // The LAST one reflects the final context size.
      const msgUsage = msg.event?.message?.usage;
      console.log("[transform] message_start usage:", JSON.stringify(msgUsage));
      if (msgUsage?.input_tokens) {
        lastApiCallInputTokens = msgUsage.input_tokens;
        console.log("[transform] Updated lastApiCallInputTokens:", lastApiCallInputTokens);
      }
    }

    // ===== STREAMING EVENTS (token-by-token) =====
    if (msg.type === "stream_event") {
      const event = msg.event;
      console.log(
        "[transform] stream_event:",
        event?.type,
        "delta:",
        event?.delta?.type,
        "content_block_type:",
        event?.content_block?.type,
      );
      // Debug: log full event when content_block_start but no type
      if (
        event?.type === "content_block_start" &&
        !event?.content_block?.type
      ) {
        console.log(
          "[transform] WARNING: content_block_start with no type, full event:",
          JSON.stringify(event),
        );
      }
      if (!event) return;

      // Text block start
      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "text"
      ) {
        if (isUsingOllama) {
          console.log(
            "[Ollama Transform] ✓ TEXT BLOCK START - Model is generating text!",
          );
        } else {
          console.log("[transform] TEXT BLOCK START");
        }
        yield* endTextBlock();
        yield* endToolInput();
        textId = genId();
        yield { type: "text-start", id: textId };
        textStarted = true;
        if (isUsingOllama) {
          console.log(
            "[Ollama Transform] textStarted set to TRUE, textId:",
            textId,
          );
        } else {
          console.log("[transform] textStarted set to TRUE, textId:", textId);
        }
      }

      // Text delta
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      ) {
        if (isUsingOllama) {
          console.log(
            "[Ollama Transform] ✓ TEXT DELTA received, length:",
            event.delta.text?.length,
            "preview:",
            event.delta.text?.slice(0, 50),
          );
        } else {
          console.log(
            "[transform] TEXT DELTA, textStarted:",
            textStarted,
            "delta:",
            event.delta.text?.slice(0, 20),
          );
        }
        if (!textStarted) {
          yield* endToolInput();
          textId = genId();
          yield { type: "text-start", id: textId };
          textStarted = true;
        }
        yield {
          type: "text-delta",
          id: textId!,
          delta: event.delta.text || "",
        };
      }

      // Content block stop
      if (event.type === "content_block_stop") {
        if (isUsingOllama) {
          console.log(
            "[Ollama Transform] CONTENT BLOCK STOP, textStarted:",
            textStarted,
          );
        } else {
          console.log(
            "[transform] CONTENT BLOCK STOP, textStarted:",
            textStarted,
          );
        }
        if (textStarted) {
          yield* endTextBlock();
          if (isUsingOllama) {
            console.log(
              "[Ollama Transform] Text block ended, textStarted now:",
              textStarted,
            );
          } else {
            console.log(
              "[transform] after endTextBlock, textStarted:",
              textStarted,
            );
          }
        }
        if (currentToolCallId) {
          yield* endToolInput();
        }
      }

      // Tool use start (streaming)
      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "tool_use"
      ) {
        yield* endTextBlock();
        yield* endToolInput();

        const originalId = event.content_block.id || genId();
        currentToolCallId = makeCompositeId(originalId, currentParentToolUseId);
        currentToolName = event.content_block.name || "unknown";
        currentToolOriginalId = originalId; // Store original ID for bash command mapping
        accumulatedToolInput = "";

        // Store mapping for tool-result lookup
        toolIdMapping.set(originalId, currentToolCallId);

        // Emit tool-input-start for progressive UI
        yield {
          type: "tool-input-start",
          toolCallId: currentToolCallId,
          toolName: currentToolName || "unknown",
        };
      }

      // Tool input delta
      if (event.delta?.type === "input_json_delta" && currentToolCallId) {
        const partialJson = event.delta.partial_json || "";
        accumulatedToolInput += partialJson;

        // Emit tool-input-delta for progressive UI
        yield {
          type: "tool-input-delta",
          toolCallId: currentToolCallId,
          inputTextDelta: partialJson,
        };
      }

      // Thinking content block start → emit as reasoning (native AI SDK streaming)
      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "thinking"
      ) {
        currentThinkingId = `thinking-${Date.now()}`;
        inThinkingBlock = true;
        // Mark as streamed IMMEDIATELY to prevent assistant message from emitting duplicate
        // (assistant message may arrive before content_block_stop)
        emittedToolIds.add("thinking-streamed");
        yield {
          type: "reasoning-start",
          id: currentThinkingId,
        };
      }

      // Thinking streaming → reasoning-delta (pure text, no JSON escaping needed)
      if (
        event.delta?.type === "thinking_delta" &&
        currentThinkingId &&
        inThinkingBlock
      ) {
        const thinkingText = String(event.delta.thinking || "");
        yield {
          type: "reasoning-delta",
          id: currentThinkingId,
          delta: thinkingText,
        };
      }

      // Thinking complete → reasoning-end
      if (
        event.type === "content_block_stop" &&
        inThinkingBlock &&
        currentThinkingId
      ) {
        yield {
          type: "reasoning-end",
          id: currentThinkingId,
        };
        // Track as emitted to skip duplicate from assistant message
        emittedToolIds.add(currentThinkingId);
        emittedToolIds.add("thinking-streamed"); // Flag to skip complete block
        currentThinkingId = null;
        inThinkingBlock = false;
      }

      // Capture per-API-call output tokens from message_delta event.
      // Anthropic API sends output_tokens in message_delta at the end of each response.
      if (event.type === "message_delta" && event.usage?.output_tokens) {
        lastApiCallOutputTokens = event.usage.output_tokens;
        console.log("[transform] Updated lastApiCallOutputTokens:", lastApiCallOutputTokens);
      }
    }

    // ===== ASSISTANT MESSAGE (complete, often with tool_use) =====
    // When streaming is enabled, text arrives via stream_event, not here
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        // Handle thinking blocks from Extended Thinking
        // Skip if already emitted via streaming (thinking_delta) or previous assistant message
        if (block.type === "thinking" && block.thinking) {
          // Check if we already emitted thinking (via streaming or previous assistant message)
          if (emittedToolIds.has("thinking-streamed")) {
            continue;
          }

          // Mark as emitted FIRST to prevent any race conditions or duplicates
          emittedToolIds.add("thinking-streamed");

          // Emit as reasoning chunks (fallback when streaming events were missed)
          const thinkingId = genId();
          yield {
            type: "reasoning-start",
            id: thinkingId,
          };
          yield {
            type: "reasoning-delta",
            id: thinkingId,
            delta: block.thinking,
          };
          yield {
            type: "reasoning-end",
            id: thinkingId,
          };
        }

        if (block.type === "text") {
          console.log(
            "[transform] ASSISTANT TEXT block, textStarted:",
            textStarted,
            "text length:",
            block.text?.length,
          );
          yield* endToolInput();

          // Only emit text if we're NOT already streaming (textStarted = false)
          // When includePartialMessages is true, text comes via stream_event
          if (!textStarted) {
            console.log(
              "[transform] EMITTING assistant text (textStarted was false)",
            );
            textId = genId();
            yield { type: "text-start", id: textId };
            yield { type: "text-delta", id: textId, delta: block.text };
            yield { type: "text-end", id: textId };
            // Track the last text ID for final response marking
            lastTextId = textId;
            textId = null;
          } else {
            console.log(
              "[transform] SKIPPING assistant text (textStarted is true)",
            );
          }
          // If textStarted is true, we're mid-stream - skip this duplicate
        }

        if (block.type === "tool_use") {
          yield* endTextBlock();
          yield* endToolInput();

          // Skip if already emitted via streaming
          if (emittedToolIds.has(block.id)) {
            console.log(
              "[transform] SKIPPING duplicate tool_use (already emitted via streaming):",
              block.id,
            );
            continue;
          }

          emittedToolIds.add(block.id);

          const compositeId = makeCompositeId(block.id, currentParentToolUseId);

          // Store mapping for tool-result lookup
          toolIdMapping.set(block.id, compositeId);

          // Store Bash command for background task naming
          if (block.name === "Bash" && block.input?.command) {
            bashCommandMapping.set(block.id, block.input.command);
          }

          yield {
            type: "tool-input-available",
            toolCallId: compositeId,
            toolName: block.name,
            input: block.input,
          };
        }
      }
    }

    // ===== USER MESSAGE (tool results) =====
    if (
      msg.type === "user" &&
      msg.message?.content &&
      Array.isArray(msg.message.content)
    ) {
      // DEBUG: Log the message structure to understand tool_use_result
      console.log("[Transform DEBUG] User message:", {
        tool_use_result: msg.tool_use_result,
        tool_use_result_type: typeof msg.tool_use_result,
        content_length: msg.message.content.length,
        blocks: msg.message.content.map((b: any) => ({
          type: b.type,
          tool_use_id: b.tool_use_id,
          content_preview:
            typeof b.content === "string"
              ? b.content.slice(0, 100)
              : typeof b.content,
        })),
      });

      for (const block of msg.message.content) {
        if (block.type === "tool_result") {
          // Lookup composite ID from mapping, fallback to original
          const compositeId =
            toolIdMapping.get(block.tool_use_id) || block.tool_use_id;

          if (block.is_error) {
            yield {
              type: "tool-output-error",
              toolCallId: compositeId,
              errorText: String(block.content),
            };
          } else {
            // Try to parse structured data from block.content if it's JSON
            let output = msg.tool_use_result;
            if (!output && typeof block.content === "string") {
              try {
                // Some tool results may have JSON embedded in the string
                const parsed = JSON.parse(block.content);
                if (parsed && typeof parsed === "object") {
                  output = parsed;
                }
              } catch {
                // Not JSON, use raw content
              }
            }
            output = output || block.content;

            console.log("[Transform DEBUG] Tool output:", {
              tool_use_id: block.tool_use_id,
              compositeId,
              output_type: typeof output,
              output_keys:
                output && typeof output === "object"
                  ? Object.keys(output)
                  : null,
              numFiles: output?.numFiles,
              backgroundTaskId: output?.backgroundTaskId,
            });

            // Check for background task ID in Bash tool result
            // When Bash runs with run_in_background=true, it returns backgroundTaskId
            if (
              output &&
              typeof output === "object" &&
              output.backgroundTaskId
            ) {
              // Get the original Bash command from our mapping
              const bashCommand = bashCommandMapping.get(block.tool_use_id);
              console.log(
                "[Transform] Background task started:",
                output.backgroundTaskId,
                "command:",
                bashCommand,
              );

              // Use command as summary, truncate if too long
              let summary: string;
              if (bashCommand) {
                // Truncate long commands, show first 60 chars
                summary =
                  bashCommand.length > 60
                    ? bashCommand.slice(0, 57) + "..."
                    : bashCommand;
              } else {
                summary = `Background task ${output.backgroundTaskId}`;
              }

              // Extract output file path from content or SDK response
              // The path can be in block.content (string) or might need to be extracted differently
              let outputFile: string | undefined;
              if (typeof block.content === "string") {
                // Match path that starts with / and continues until end of line
                const match = block.content.match(
                  /Output is being written to: (\/[^\n\r]+)/,
                );
                if (match) {
                  outputFile = match[1].trim();
                }
              }
              // Also check if it's in the content array (tool_result can have array content)
              if (!outputFile && Array.isArray(block.content)) {
                for (const item of block.content) {
                  if (item.type === "text" && typeof item.text === "string") {
                    const match = item.text.match(
                      /Output is being written to: (\/[^\n\r]+)/,
                    );
                    if (match) {
                      outputFile = match[1].trim();
                      break;
                    }
                  }
                }
              }
              console.log(
                "[Transform] Background task outputFile extraction:",
                {
                  contentType: typeof block.content,
                  isArray: Array.isArray(block.content),
                  extractedPath: outputFile,
                  fullContent:
                    typeof block.content === "string"
                      ? block.content
                      : JSON.stringify(block.content),
                },
              );

              yield {
                type: "task-notification",
                taskId: output.backgroundTaskId,
                shellId: output.backgroundTaskId,
                status: "running" as const,
                outputFile,
                summary,
                command: bashCommand,
              };
            }

            yield {
              type: "tool-output-available",
              toolCallId: compositeId,
              output,
            };
          }
        }
      }
    }

    // ===== SYSTEM STATUS (compacting, etc.) =====
    if (msg.type === "system") {
      // Debug: log all system message subtypes
      console.log(
        "[transform] SYSTEM subtype:",
        msg.subtype,
        "full msg:",
        JSON.stringify(msg),
      );

      // Session init - extract MCP servers, plugins, tools
      if (msg.subtype === "init") {
        console.log("[MCP Transform] Received SDK init message:", {
          tools: msg.tools?.length,
          mcp_servers: msg.mcp_servers,
          plugins: msg.plugins,
          skills: msg.skills?.length,
        });
        // Map MCP servers with validated status type and additional info
        const mcpServers: MCPServer[] = (msg.mcp_servers || []).map(
          (s: {
            name: string;
            status: string;
            serverInfo?: {
              name: string;
              version: string;
              icons?: {
                src: string;
                mimeType?: string;
                sizes?: string[];
                theme?: "light" | "dark";
              }[];
            };
            error?: string;
          }) => ({
            name: s.name,
            status: (["connected", "failed", "pending", "needs-auth"].includes(
              s.status,
            )
              ? s.status
              : "pending") as MCPServerStatus,
            ...(s.serverInfo && { serverInfo: s.serverInfo }),
            ...(s.error && { error: s.error }),
          }),
        );
        yield {
          type: "session-init",
          tools: msg.tools || [],
          mcpServers,
          plugins: msg.plugins || [],
          skills: msg.skills || [],
        };
      }

      // Compacting status - show as a tool
      if (msg.subtype === "status" && msg.status === "compacting") {
        // Create unique ID and save for matching with boundary event
        lastCompactId = `compact-${Date.now()}-${compactCounter++}`;
        yield {
          type: "system-Compact",
          toolCallId: lastCompactId,
          state: "input-streaming",
        };
      }

      // Compact boundary - mark the compacting tool as complete
      if (msg.subtype === "compact_boundary" && lastCompactId) {
        yield {
          type: "system-Compact",
          toolCallId: lastCompactId,
          state: "output-available",
        };
        lastCompactId = null; // Clear for next compacting cycle
      }

      // Task notification - background task status update (completed/failed/stopped)
      // Note: SDKTaskNotificationMessage doesn't have shell_id, use task_id as shellId
      if (msg.subtype === "task_notification") {
        console.log("[Transform] Task notification received:", {
          task_id: msg.task_id,
          status: msg.status,
          output_file: msg.output_file,
          summary: msg.summary,
        });
        yield {
          type: "task-notification",
          taskId: msg.task_id,
          shellId: msg.task_id, // SDK doesn't provide shell_id in notification, use task_id
          status: msg.status,
          outputFile: msg.output_file,
          summary: msg.summary,
        };
      }
    }

    // ===== RESULT (final) =====
    if (msg.type === "result") {
      yield* endTextBlock();
      yield* endToolInput();

      // Debug: log the raw result message to understand token data structure
      console.log("[transform] RESULT msg.usage:", JSON.stringify(msg.usage));
      console.log(
        "[transform] RESULT msg.modelUsage:",
        JSON.stringify(msg.modelUsage),
      );

      const inputTokens = msg.usage?.input_tokens;
      const outputTokens = msg.usage?.output_tokens;

      // Extract per-model usage from SDK (if available)
      const modelUsage = msg.modelUsage
        ? Object.fromEntries(
            Object.entries(msg.modelUsage).map(
              ([model, usage]: [string, any]) => [
                model,
                {
                  inputTokens: usage.inputTokens || 0,
                  outputTokens: usage.outputTokens || 0,
                  cacheReadInputTokens: usage.cacheReadInputTokens || 0,
                  cacheCreationInputTokens: usage.cacheCreationInputTokens || 0,
                  costUSD: usage.costUSD || 0,
                },
              ],
            ),
          )
        : undefined;

      console.log("[transform] Building metadata with lastCall tokens:", {
        lastApiCallInputTokens,
        lastApiCallOutputTokens,
        inputTokens,
        outputTokens,
      });
      const metadata: MessageMetadata = {
        sessionId: msg.session_id,
        sdkMessageUuid: emitSdkMessageUuid ? msg.uuid : undefined,
        inputTokens,
        outputTokens,
        totalTokens:
          inputTokens && outputTokens ? inputTokens + outputTokens : undefined,
        totalCostUsd: msg.total_cost_usd,
        durationMs: startTime ? Date.now() - startTime : undefined,
        resultSubtype: msg.subtype || "success",
        // Include finalTextId for collapsing tools when there's a final response
        finalTextId: lastTextId || undefined,
        // Per-model usage breakdown
        modelUsage,
        // Per-API-call tokens from streaming events (last call = actual context size)
        lastCallInputTokens: lastApiCallInputTokens || undefined,
        lastCallOutputTokens: lastApiCallOutputTokens || undefined,
      };
      console.log("[transform] Emitting message-metadata:", JSON.stringify(metadata));
      yield { type: "message-metadata", messageMetadata: metadata };
      yield { type: "finish-step" };
      yield { type: "finish", messageMetadata: metadata };
    }
  };
}
