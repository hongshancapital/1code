import type { IdManagerState } from "./interfaces";

/**
 * ID 管理器：处理工具 ID 映射与去重
 *
 * 职责：
 * 1. 原始 ID -> 复合 ID 映射 (支持嵌套工具)
 * 2. 去重已发射的工具 (避免流式 + 完整消息重复)
 * 3. 生成复合 ID (parentId:childId 格式)
 * 4. 工具名追踪 (originalId -> toolName)
 * 5. 工具输入追踪 (originalId -> input)
 */
export class IdManager {
  private toolIdMapping = new Map<string, string>();
  private emittedToolIds = new Set<string>();
  private toolNameMapping = new Map<string, string>(); // originalId -> toolName
  private toolInputMapping = new Map<string, Record<string, unknown>>(); // originalId -> input

  /**
   * 创建复合 ID：parentId:childId 或 childId
   */
  makeCompositeId(originalId: string, parentId: string | null): string {
    if (parentId) return `${parentId}:${originalId}`;
    return originalId;
  }

  /**
   * 保存 ID 映射关系
   */
  setMapping(originalId: string, compositeId: string, toolName?: string): void {
    this.toolIdMapping.set(originalId, compositeId);
    if (toolName) {
      this.toolNameMapping.set(originalId, toolName);
    }
  }

  /**
   * 查询复合 ID (返回映射结果或原始 ID)
   */
  getCompositeId(originalId: string): string {
    return this.toolIdMapping.get(originalId) || originalId;
  }

  /**
   * 标记工具 ID 已发射 (去重)
   */
  markEmitted(toolId: string): void {
    this.emittedToolIds.add(toolId);
  }

  /**
   * 检查工具 ID 是否已发射
   */
  isEmitted(toolId: string): boolean {
    return this.emittedToolIds.has(toolId);
  }

  /**
   * 查询工具名
   */
  getToolName(originalId: string): string | undefined {
    return this.toolNameMapping.get(originalId);
  }

  /**
   * 保存工具输入
   */
  setInput(originalId: string, input: Record<string, unknown>): void {
    this.toolInputMapping.set(originalId, input);
  }

  /**
   * 查询工具输入
   */
  getInput(originalId: string): Record<string, unknown> | undefined {
    return this.toolInputMapping.get(originalId);
  }

  /**
   * 获取当前状态 (用于测试)
   */
  getState(): IdManagerState {
    return {
      toolIdMapping: new Map(this.toolIdMapping),
      emittedToolIds: new Set(this.emittedToolIds),
    };
  }

  /**
   * 重置状态 (每个会话独立)
   */
  reset(): void {
    this.toolIdMapping.clear();
    this.emittedToolIds.clear();
    this.toolNameMapping.clear();
    this.toolInputMapping.clear();
  }
}
