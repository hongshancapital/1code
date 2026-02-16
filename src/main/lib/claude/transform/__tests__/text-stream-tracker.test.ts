import { describe, it, expect, beforeEach } from "vitest";
import { TextStreamTracker } from "../trackers/text-stream-tracker";

describe("TextStreamTracker", () => {
  let tracker: TextStreamTracker;

  beforeEach(() => {
    tracker = new TextStreamTracker();
  });

  describe("start", () => {
    it("should emit text-start chunk", () => {
      const chunks = Array.from(tracker.start("text-123"));
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "text-start",
        id: "text-123",
      });
    });

    it("should auto-generate ID if not provided", () => {
      const chunks = Array.from(tracker.start());
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("text-start");
      expect(chunks[0].id).toMatch(/^text-/);
    });

    it("should end previous stream before starting new one", () => {
      Array.from(tracker.start("text-1"));
      const chunks = Array.from(tracker.start("text-2"));

      // Should emit: text-end (for text-1) + text-start (for text-2)
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({ type: "text-end", id: "text-1" });
      expect(chunks[1]).toMatchObject({ type: "text-start", id: "text-2" });
    });
  });

  describe("delta", () => {
    it("should emit text-delta chunk", () => {
      Array.from(tracker.start("text-123"));
      const chunks = Array.from(tracker.delta("Hello"));

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "text-delta",
        id: "text-123",
        delta: "Hello",
      });
    });

    it("should auto-start if not started", () => {
      const chunks = Array.from(tracker.delta("Hello"));

      // Should emit: text-start + text-delta
      expect(chunks).toHaveLength(2);
      expect(chunks[0].type).toBe("text-start");
      expect(chunks[1]).toMatchObject({
        type: "text-delta",
        delta: "Hello",
      });
    });

    it("should accumulate multiple deltas", () => {
      Array.from(tracker.start("text-123"));
      const chunks1 = Array.from(tracker.delta("Hello"));
      const chunks2 = Array.from(tracker.delta(" "));
      const chunks3 = Array.from(tracker.delta("World"));

      expect(chunks1[0].delta).toBe("Hello");
      expect(chunks2[0].delta).toBe(" ");
      expect(chunks3[0].delta).toBe("World");
    });
  });

  describe("end", () => {
    it("should emit text-end chunk", () => {
      Array.from(tracker.start("text-123"));
      const chunks = Array.from(tracker.end());

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "text-end",
        id: "text-123",
      });
    });

    it("should not emit if not started", () => {
      const chunks = Array.from(tracker.end());
      expect(chunks).toHaveLength(0);
    });

    it("should preserve textId for lastTextId tracking", () => {
      Array.from(tracker.start("text-123"));
      Array.from(tracker.end());

      expect(tracker.getCurrentTextId()).toBe("text-123");
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      Array.from(tracker.start("text-123"));
      const state = tracker.getState();

      expect(state).toMatchObject({
        textId: "text-123",
        textStarted: true,
      });
    });

    it("should reflect ended state", () => {
      Array.from(tracker.start("text-123"));
      Array.from(tracker.end());
      const state = tracker.getState();

      expect(state).toMatchObject({
        textId: "text-123",
        textStarted: false,
      });
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      Array.from(tracker.start("text-123"));
      tracker.reset();

      const state = tracker.getState();
      expect(state.textId).toBeNull();
      expect(state.textStarted).toBe(false);
    });
  });

  describe("complex flow", () => {
    it("should handle full text streaming lifecycle", () => {
      const allChunks: any[] = [];

      allChunks.push(...tracker.start("text-1"));
      allChunks.push(...tracker.delta("Hello"));
      allChunks.push(...tracker.delta(" "));
      allChunks.push(...tracker.delta("World"));
      allChunks.push(...tracker.end());

      expect(allChunks).toEqual([
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Hello" },
        { type: "text-delta", id: "text-1", delta: " " },
        { type: "text-delta", id: "text-1", delta: "World" },
        { type: "text-end", id: "text-1" },
      ]);
    });
  });
});
