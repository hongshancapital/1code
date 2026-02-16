import { describe, it, expect, beforeEach } from "vitest";
import { IdManager } from "../id-manager";

describe("IdManager", () => {
  let manager: IdManager;

  beforeEach(() => {
    manager = new IdManager();
  });

  describe("makeCompositeId", () => {
    it("should return originalId when no parent", () => {
      expect(manager.makeCompositeId("tool-123", null)).toBe("tool-123");
    });

    it("should create parentId:childId when parent exists", () => {
      expect(manager.makeCompositeId("tool-123", "parent-456")).toBe(
        "parent-456:tool-123",
      );
    });

    it("should handle nested parent IDs", () => {
      expect(manager.makeCompositeId("tool-123", "parent1:parent2")).toBe(
        "parent1:parent2:tool-123",
      );
    });
  });

  describe("setMapping and getCompositeId", () => {
    it("should store and retrieve ID mapping", () => {
      manager.setMapping("original-1", "composite-1");
      expect(manager.getCompositeId("original-1")).toBe("composite-1");
    });

    it("should return original ID when no mapping exists", () => {
      expect(manager.getCompositeId("unknown")).toBe("unknown");
    });

    it("should handle multiple mappings", () => {
      manager.setMapping("orig-1", "comp-1");
      manager.setMapping("orig-2", "comp-2");
      expect(manager.getCompositeId("orig-1")).toBe("comp-1");
      expect(manager.getCompositeId("orig-2")).toBe("comp-2");
    });
  });

  describe("markEmitted and isEmitted", () => {
    it("should track emitted tool IDs", () => {
      expect(manager.isEmitted("tool-123")).toBe(false);
      manager.markEmitted("tool-123");
      expect(manager.isEmitted("tool-123")).toBe(true);
    });

    it("should handle multiple emitted IDs", () => {
      manager.markEmitted("tool-1");
      manager.markEmitted("tool-2");
      expect(manager.isEmitted("tool-1")).toBe(true);
      expect(manager.isEmitted("tool-2")).toBe(true);
      expect(manager.isEmitted("tool-3")).toBe(false);
    });
  });

  describe("getState", () => {
    it("should return current state snapshot", () => {
      manager.setMapping("orig-1", "comp-1");
      manager.markEmitted("tool-1");

      const state = manager.getState();
      expect(state.toolIdMapping.get("orig-1")).toBe("comp-1");
      expect(state.emittedToolIds.has("tool-1")).toBe(true);
    });

    it("should return independent copies", () => {
      const state1 = manager.getState();
      manager.setMapping("orig-1", "comp-1");
      const state2 = manager.getState();

      expect(state1.toolIdMapping.size).toBe(0);
      expect(state2.toolIdMapping.size).toBe(1);
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      manager.setMapping("orig-1", "comp-1");
      manager.markEmitted("tool-1");

      manager.reset();

      expect(manager.getCompositeId("orig-1")).toBe("orig-1");
      expect(manager.isEmitted("tool-1")).toBe(false);
    });
  });
});
