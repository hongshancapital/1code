/**
 * Transform 集成测试
 *
 * 使用模拟 SDK 消息验证新版本的基本功能
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTransformer } from "../../transform-v2";

describe("Transform Integration", () => {
  let transform: ReturnType<typeof createTransformer>;

  beforeEach(() => {
    transform = createTransformer();
  });

  describe("基本流程", () => {
    it("应该发射 start chunk", () => {
      const msg = { type: "system", subtype: "init" };
      const chunks = Array.from(transform(msg));

      expect(chunks.some((c) => c.type === "start")).toBe(true);
      expect(chunks.some((c) => c.type === "start-step")).toBe(true);
    });

    it("应该处理 session-init 消息", () => {
      const msg = {
        type: "system",
        subtype: "init",
        tools: [{ name: "Read" }],
        mcp_servers: [{ name: "test-server", status: "connected" }],
        plugins: [],
        skills: [],
      };

      const chunks = Array.from(transform(msg));
      const sessionInit = chunks.find((c) => c.type === "session-init");

      expect(sessionInit).toBeDefined();
      expect(sessionInit?.tools).toHaveLength(1);
      expect(sessionInit?.mcpServers).toHaveLength(1);
    });
  });

  describe("文本流", () => {
    it("应该处理流式文本", () => {
      // 先发送 start
      Array.from(transform({ type: "system", subtype: "init" }));

      // 文本流开始
      const chunks1 = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "text" } },
        }),
      );

      // 文本增量
      const chunks2 = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
        }),
      );

      const chunks3 = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: " World" } },
        }),
      );

      // 验证 text-start
      expect(chunks1.some((c) => c.type === "text-start")).toBe(true);

      // 验证 text-delta
      const delta1 = chunks2.find((c) => c.type === "text-delta");
      const delta2 = chunks3.find((c) => c.type === "text-delta");
      expect(delta1?.delta).toBe("Hello");
      expect(delta2?.delta).toBe(" World");
    });

    it("应该在 content_block_stop 时结束文本流", () => {
      // 初始化
      Array.from(transform({ type: "system", subtype: "init" }));

      // 开始文本流
      Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "text" } },
        }),
      );

      // 文本增量
      Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "Test" } },
        }),
      );

      // 结束
      const stopChunks = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      );

      expect(stopChunks.some((c) => c.type === "text-end")).toBe(true);
    });
  });

  describe("工具调用", () => {
    it("应该处理流式工具调用", () => {
      Array.from(transform({ type: "system", subtype: "init" }));

      // 工具调用开始
      const chunks1 = Array.from(
        transform({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", id: "tool-123", name: "Read" },
          },
        }),
      );

      // 工具输入增量
      const chunks2 = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"file_path":' } },
        }),
      );

      const chunks3 = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '"/test.ts"}' } },
        }),
      );

      // 结束
      const chunks4 = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      );

      // 验证 tool-input-start
      expect(chunks1.some((c) => c.type === "tool-input-start")).toBe(true);

      // 验证 tool-input-delta
      expect(chunks2.some((c) => c.type === "tool-input-delta")).toBe(true);

      // 验证 tool-input-available
      const available = chunks4.find((c) => c.type === "tool-input-available");
      expect(available).toBeDefined();
      expect(available?.toolName).toBe("Read");
      expect(available?.input).toEqual({ file_path: "/test.ts" });
    });

    it("应该处理 assistant 消息中的工具调用（去重）", () => {
      Array.from(transform({ type: "system", subtype: "init" }));

      // 流式工具调用（已发射）
      Array.from(
        transform({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", id: "tool-123", name: "Read" },
          },
        }),
      );
      Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"file_path":"/test.ts"}' } },
        }),
      );
      Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      );

      // assistant 消息（应该被去重）
      const chunks = Array.from(
        transform({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "tool-123", name: "Read", input: { file_path: "/test.ts" } },
            ],
          },
        }),
      );

      // 不应该再次发射 tool-input-available
      expect(chunks.filter((c) => c.type === "tool-input-available")).toHaveLength(0);
    });
  });

  describe("工具结果", () => {
    it("应该处理 tool_result 消息", () => {
      Array.from(transform({ type: "system", subtype: "init" }));

      // 先有工具调用
      Array.from(
        transform({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "tool-123", name: "Read", input: { file_path: "/test.ts" } },
            ],
          },
        }),
      );

      // 工具结果
      const chunks = Array.from(
        transform({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tool-123", content: "file content here" },
            ],
          },
        }),
      );

      const output = chunks.find((c) => c.type === "tool-output-available");
      expect(output).toBeDefined();
      expect(output?.toolCallId).toBe("tool-123");
      expect(output?.output).toBe("file content here");
    });

    it("应该处理错误结果", () => {
      Array.from(transform({ type: "system", subtype: "init" }));

      const chunks = Array.from(
        transform({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tool-123", is_error: true, content: "Error: file not found" },
            ],
          },
        }),
      );

      const error = chunks.find((c) => c.type === "tool-output-error");
      expect(error).toBeDefined();
      expect(error?.errorText).toBe("Error: file not found");
    });
  });

  describe("Compacting", () => {
    it("应该处理 compacting 状态机", () => {
      Array.from(transform({ type: "system", subtype: "init" }));

      // status: compacting
      const chunks1 = Array.from(
        transform({
          type: "system",
          subtype: "status",
          status: "compacting",
        }),
      );

      const compactStart = chunks1.find((c) => c.type === "system-Compact");
      expect(compactStart).toBeDefined();
      expect(compactStart?.state).toBe("input-streaming");

      // compact_boundary
      const chunks2 = Array.from(
        transform({
          type: "system",
          subtype: "compact_boundary",
        }),
      );

      const compactEnd = chunks2.find((c) => c.type === "system-Compact");
      expect(compactEnd).toBeDefined();
      expect(compactEnd?.state).toBe("output-available");
      expect(compactEnd?.toolCallId).toBe(compactStart?.toolCallId);
    });
  });

  describe("Result 消息", () => {
    it("应该生成 message-metadata 和 finish", () => {
      Array.from(transform({ type: "system", subtype: "init" }));

      const chunks = Array.from(
        transform({
          type: "result",
          session_id: "session-123",
          usage: { input_tokens: 1000, output_tokens: 500 },
          total_cost_usd: 0.05,
          subtype: "success",
        }),
      );

      const metadata = chunks.find((c) => c.type === "message-metadata");
      expect(metadata).toBeDefined();
      expect(metadata?.messageMetadata?.sessionId).toBe("session-123");
      expect(metadata?.messageMetadata?.inputTokens).toBe(1000);
      expect(metadata?.messageMetadata?.outputTokens).toBe(500);
      expect(metadata?.messageMetadata?.totalTokens).toBe(1500);

      expect(chunks.some((c) => c.type === "finish-step")).toBe(true);
      expect(chunks.some((c) => c.type === "finish")).toBe(true);
    });
  });

  describe("Extended Thinking", () => {
    it("应该处理流式 thinking", () => {
      Array.from(transform({ type: "system", subtype: "init" }));

      // thinking 开始
      const chunks1 = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "thinking" } },
        }),
      );

      // thinking 增量
      const chunks2 = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me think..." } },
        }),
      );

      // thinking 结束
      const chunks3 = Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      );

      expect(chunks1.some((c) => c.type === "reasoning-start")).toBe(true);
      const delta = chunks2.find((c) => c.type === "reasoning-delta");
      expect(delta?.delta).toBe("Let me think...");
      expect(chunks3.some((c) => c.type === "reasoning-end")).toBe(true);
    });

    it("应该去重 assistant 消息中的 thinking", () => {
      Array.from(transform({ type: "system", subtype: "init" }));

      // 流式 thinking（已发射）
      Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "thinking" } },
        }),
      );
      Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Thinking..." } },
        }),
      );
      Array.from(
        transform({
          type: "stream_event",
          event: { type: "content_block_stop" },
        }),
      );

      // assistant 消息（应该被去重）
      const chunks = Array.from(
        transform({
          type: "assistant",
          message: {
            content: [{ type: "thinking", thinking: "Thinking..." }],
          },
        }),
      );

      // 不应该再次发射 reasoning chunks
      expect(chunks.filter((c) => c.type === "reasoning-start")).toHaveLength(0);
    });
  });
});
