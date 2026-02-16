import { describe, it, expect, beforeEach } from "vitest";
import { ToolStreamTracker } from "../trackers/tool-stream-tracker";

describe("ToolStreamTracker", () => {
  let tracker: ToolStreamTracker;

  beforeEach(() => {
    tracker = new ToolStreamTracker();
  });

  describe("start", () => {
    it("should emit tool-input-start chunk", () => {
      const chunks = Array.from(
        tracker.start({
          toolCallId: "tool-123",
          toolName: "Bash",
          originalId: "orig-123",
        }),
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "tool-input-start",
        toolCallId: "tool-123",
        toolName: "Bash",
      });
    });

    it("should end previous tool before starting new one", () => {
      Array.from(
        tracker.start({
          toolCallId: "tool-1",
          toolName: "Bash",
          originalId: "orig-1",
        }),
      );
      Array.from(tracker.delta('{"command":"ls"}'));

      const chunks = Array.from(
        tracker.start({
          toolCallId: "tool-2",
          toolName: "Read",
          originalId: "orig-2",
        }),
      );

      // Should emit: tool-input-available (for tool-1) + tool-input-start (for tool-2)
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({
        type: "tool-input-available",
        toolCallId: "tool-1",
      });
      expect(chunks[1]).toMatchObject({
        type: "tool-input-start",
        toolCallId: "tool-2",
      });
    });
  });

  describe("delta", () => {
    it("should emit tool-input-delta chunk", () => {
      Array.from(
        tracker.start({
          toolCallId: "tool-123",
          toolName: "Bash",
          originalId: "orig-123",
        }),
      );
      const chunks = Array.from(tracker.delta('{"command"'));

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "tool-input-delta",
        toolCallId: "tool-123",
        inputTextDelta: '{"command"',
      });
    });

    it("should accumulate partial JSON", () => {
      Array.from(
        tracker.start({
          toolCallId: "tool-123",
          toolName: "Bash",
          originalId: "orig-123",
        }),
      );
      Array.from(tracker.delta('{"command":'));
      Array.from(tracker.delta('"ls"'));
      Array.from(tracker.delta("}"));

      const state = tracker.getState();
      expect(state.accumulatedToolInput).toBe('{"command":"ls"}');
    });
  });

  describe("end", () => {
    it("should emit tool-input-available with parsed JSON", () => {
      Array.from(
        tracker.start({
          toolCallId: "tool-123",
          toolName: "Bash",
          originalId: "orig-123",
        }),
      );
      Array.from(tracker.delta('{"command":"ls -la"}'));

      const chunks = Array.from(tracker.end());

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "tool-input-available",
        toolCallId: "tool-123",
        toolName: "Bash",
        input: { command: "ls -la" },
      });
    });

    it("should handle incomplete JSON gracefully", () => {
      Array.from(
        tracker.start({
          toolCallId: "tool-123",
          toolName: "Bash",
          originalId: "orig-123",
        }),
      );
      Array.from(tracker.delta('{"command":"ls'));

      const chunks = Array.from(tracker.end());

      expect(chunks).toHaveLength(1);
      expect(chunks[0].input).toMatchObject({
        _raw: '{"command":"ls',
        _parseError: true,
      });
    });

    it("should not emit if not started", () => {
      const chunks = Array.from(tracker.end());
      expect(chunks).toHaveLength(0);
    });
  });

  describe("getCurrentContext", () => {
    it("should return current tool context", () => {
      Array.from(
        tracker.start({
          toolCallId: "tool-123",
          toolName: "Bash",
          originalId: "orig-123",
        }),
      );
      Array.from(tracker.delta('{"command":"ls"}'));

      const context = tracker.getCurrentContext();

      expect(context).toMatchObject({
        toolCallId: "tool-123",
        originalId: "orig-123",
        toolName: "Bash",
        input: { command: "ls" },
      });
    });

    it("should return null if not started", () => {
      expect(tracker.getCurrentContext()).toBeNull();
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      Array.from(
        tracker.start({
          toolCallId: "tool-123",
          toolName: "Bash",
          originalId: "orig-123",
        }),
      );
      Array.from(tracker.delta('{"command":"ls"}'));

      tracker.reset();

      const state = tracker.getState();
      expect(state.currentToolCallId).toBeNull();
      expect(state.currentToolName).toBeNull();
      expect(state.currentToolOriginalId).toBeNull();
      expect(state.accumulatedToolInput).toBe("");
    });
  });

  describe("complex flow", () => {
    it("should handle full tool streaming lifecycle", () => {
      const allChunks: any[] = [];

      allChunks.push(
        ...tracker.start({
          toolCallId: "tool-1",
          toolName: "Bash",
          originalId: "orig-1",
        }),
      );
      allChunks.push(...tracker.delta('{"command":'));
      allChunks.push(...tracker.delta('"npm test"'));
      allChunks.push(...tracker.delta("}"));
      allChunks.push(...tracker.end());

      expect(allChunks).toEqual([
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "Bash" },
        {
          type: "tool-input-delta",
          toolCallId: "tool-1",
          inputTextDelta: '{"command":',
        },
        {
          type: "tool-input-delta",
          toolCallId: "tool-1",
          inputTextDelta: '"npm test"',
        },
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: "}" },
        {
          type: "tool-input-available",
          toolCallId: "tool-1",
          toolName: "Bash",
          input: { command: "npm test" },
        },
      ]);
    });
  });
});
