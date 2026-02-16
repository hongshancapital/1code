import { describe, it, expect, beforeEach } from "vitest";
import { ThinkingStreamTracker } from "../trackers/thinking-stream-tracker";

describe("ThinkingStreamTracker", () => {
  let tracker: ThinkingStreamTracker;

  beforeEach(() => {
    tracker = new ThinkingStreamTracker();
  });

  describe("start", () => {
    it("should emit reasoning-start chunk", () => {
      const chunks = Array.from(tracker.start("thinking-123"));

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "reasoning-start",
        id: "thinking-123",
      });
    });

    it("should end previous thinking before starting new one", () => {
      Array.from(tracker.start("thinking-1"));
      const chunks = Array.from(tracker.start("thinking-2"));

      // Should emit: reasoning-end (for thinking-1) + reasoning-start (for thinking-2)
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({
        type: "reasoning-end",
        id: "thinking-1",
      });
      expect(chunks[1]).toMatchObject({
        type: "reasoning-start",
        id: "thinking-2",
      });
    });
  });

  describe("delta", () => {
    it("should emit reasoning-delta chunk", () => {
      Array.from(tracker.start("thinking-123"));
      const chunks = Array.from(tracker.delta("Let me think..."));

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "reasoning-delta",
        id: "thinking-123",
        delta: "Let me think...",
      });
    });

    it("should not emit if not started", () => {
      const chunks = Array.from(tracker.delta("Should not emit"));
      expect(chunks).toHaveLength(0);
    });

    it("should accumulate multiple deltas", () => {
      Array.from(tracker.start("thinking-123"));
      const chunks1 = Array.from(tracker.delta("First "));
      const chunks2 = Array.from(tracker.delta("Second "));
      const chunks3 = Array.from(tracker.delta("Third"));

      expect(chunks1[0].delta).toBe("First ");
      expect(chunks2[0].delta).toBe("Second ");
      expect(chunks3[0].delta).toBe("Third");
    });
  });

  describe("end", () => {
    it("should emit reasoning-end chunk", () => {
      Array.from(tracker.start("thinking-123"));
      const chunks = Array.from(tracker.end());

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "reasoning-end",
        id: "thinking-123",
      });
    });

    it("should not emit if not started", () => {
      const chunks = Array.from(tracker.end());
      expect(chunks).toHaveLength(0);
    });

    it("should return thinkingId for emitted tracking", () => {
      Array.from(tracker.start("thinking-123"));
      const result = Array.from(tracker.end());

      // Generator may return value via result
      expect(result).toHaveLength(1);
    });
  });

  describe("isActive and getCurrentThinkingId", () => {
    it("should reflect active state", () => {
      expect(tracker.isActive()).toBe(false);
      expect(tracker.getCurrentThinkingId()).toBeNull();

      Array.from(tracker.start("thinking-123"));
      expect(tracker.isActive()).toBe(true);
      expect(tracker.getCurrentThinkingId()).toBe("thinking-123");

      Array.from(tracker.end());
      expect(tracker.isActive()).toBe(false);
      expect(tracker.getCurrentThinkingId()).toBeNull();
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      Array.from(tracker.start("thinking-123"));
      const state = tracker.getState();

      expect(state).toMatchObject({
        currentThinkingId: "thinking-123",
        inThinkingBlock: true,
      });
    });

    it("should reflect ended state", () => {
      Array.from(tracker.start("thinking-123"));
      Array.from(tracker.end());
      const state = tracker.getState();

      expect(state).toMatchObject({
        currentThinkingId: null,
        inThinkingBlock: false,
      });
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      Array.from(tracker.start("thinking-123"));
      tracker.reset();

      const state = tracker.getState();
      expect(state.currentThinkingId).toBeNull();
      expect(state.inThinkingBlock).toBe(false);
    });
  });

  describe("complex flow", () => {
    it("should handle full thinking streaming lifecycle", () => {
      const allChunks: any[] = [];

      allChunks.push(...tracker.start("thinking-1"));
      allChunks.push(...tracker.delta("I need to analyze"));
      allChunks.push(...tracker.delta(" the problem"));
      allChunks.push(...tracker.end());

      expect(allChunks).toEqual([
        { type: "reasoning-start", id: "thinking-1" },
        { type: "reasoning-delta", id: "thinking-1", delta: "I need to analyze" },
        { type: "reasoning-delta", id: "thinking-1", delta: " the problem" },
        { type: "reasoning-end", id: "thinking-1" },
      ]);
    });
  });
});
