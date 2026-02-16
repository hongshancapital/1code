import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../state-manager";

describe("StateManager", () => {
  let manager: StateManager;

  beforeEach(() => {
    manager = new StateManager();
  });

  describe("session lifecycle", () => {
    it("should start as not started", () => {
      expect(manager.isStarted()).toBe(false);
      expect(manager.getStartTime()).toBeNull();
    });

    it("should track started state and time", () => {
      const before = Date.now();
      manager.start();
      const after = Date.now();

      expect(manager.isStarted()).toBe(true);
      const startTime = manager.getStartTime();
      expect(startTime).toBeGreaterThanOrEqual(before);
      expect(startTime).toBeLessThanOrEqual(after);
    });
  });

  describe("parent tool use ID", () => {
    it("should start as null", () => {
      expect(manager.getParentToolUseId()).toBeNull();
    });

    it("should set and get parent tool use ID", () => {
      manager.setParentToolUseId("parent-123");
      expect(manager.getParentToolUseId()).toBe("parent-123");
    });

    it("should allow clearing parent tool use ID", () => {
      manager.setParentToolUseId("parent-123");
      manager.setParentToolUseId(null);
      expect(manager.getParentToolUseId()).toBeNull();
    });
  });

  describe("last text ID", () => {
    it("should start as null", () => {
      expect(manager.getLastTextId()).toBeNull();
    });

    it("should set and get last text ID", () => {
      manager.setLastTextId("text-123");
      expect(manager.getLastTextId()).toBe("text-123");
    });

    it("should allow overwriting last text ID", () => {
      manager.setLastTextId("text-1");
      manager.setLastTextId("text-2");
      expect(manager.getLastTextId()).toBe("text-2");
    });
  });

  describe("token tracking", () => {
    it("should start with zero tokens", () => {
      expect(manager.getLastApiCallInputTokens()).toBe(0);
      expect(manager.getLastApiCallOutputTokens()).toBe(0);
    });

    it("should track input tokens", () => {
      manager.setLastApiCallInputTokens(1000);
      expect(manager.getLastApiCallInputTokens()).toBe(1000);
    });

    it("should track output tokens", () => {
      manager.setLastApiCallOutputTokens(500);
      expect(manager.getLastApiCallOutputTokens()).toBe(500);
    });

    it("should allow updating tokens multiple times", () => {
      manager.setLastApiCallInputTokens(1000);
      manager.setLastApiCallInputTokens(2000);
      expect(manager.getLastApiCallInputTokens()).toBe(2000);
    });
  });

  describe("state snapshots", () => {
    it("should return session state snapshot", () => {
      manager.start();
      manager.setParentToolUseId("parent-123");
      manager.setLastTextId("text-123");

      const state = manager.getSessionState();
      expect(state.started).toBe(true);
      expect(state.currentParentToolUseId).toBe("parent-123");
      expect(state.lastTextId).toBe("text-123");
      expect(state.startTime).toBeGreaterThan(0);
    });

    it("should return token state snapshot", () => {
      manager.setLastApiCallInputTokens(1000);
      manager.setLastApiCallOutputTokens(500);

      const state = manager.getTokenState();
      expect(state.lastApiCallInputTokens).toBe(1000);
      expect(state.lastApiCallOutputTokens).toBe(500);
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      manager.start();
      manager.setParentToolUseId("parent-123");
      manager.setLastTextId("text-123");
      manager.setLastApiCallInputTokens(1000);
      manager.setLastApiCallOutputTokens(500);

      manager.reset();

      expect(manager.isStarted()).toBe(false);
      expect(manager.getStartTime()).toBeNull();
      expect(manager.getParentToolUseId()).toBeNull();
      expect(manager.getLastTextId()).toBeNull();
      expect(manager.getLastApiCallInputTokens()).toBe(0);
      expect(manager.getLastApiCallOutputTokens()).toBe(0);
    });
  });
});
