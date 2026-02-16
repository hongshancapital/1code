import type { ToolEnhancer } from "../interfaces";

/**
 * SystemCompact 增强器：管理 compacting 状态机
 *
 * 职责：
 * 1. 生成唯一 compact ID
 * 2. 配对 status:compacting → compact_boundary 事件
 *
 * 注意：这不是真正的 ToolEnhancer (不匹配工具名)
 * 而是一个专用状态管理器，通过 SystemHandler 调用
 */
export class SystemCompactEnhancer {
  private lastCompactId: string | null = null;
  private compactCounter = 0;

  /**
   * 开始 compacting (status: compacting)
   */
  startCompacting(): { compactId: string } {
    this.lastCompactId = `compact-${Date.now()}-${this.compactCounter++}`;
    return { compactId: this.lastCompactId };
  }

  /**
   * 完成 compacting (compact_boundary)
   */
  finishCompacting(): { compactId: string | null } {
    const compactId = this.lastCompactId;
    this.lastCompactId = null; // 清空以准备下次
    return { compactId };
  }

  /**
   * 获取当前状态 (用于测试)
   */
  getState(): { lastCompactId: string | null; compactCounter: number } {
    return {
      lastCompactId: this.lastCompactId,
      compactCounter: this.compactCounter,
    };
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.lastCompactId = null;
    this.compactCounter = 0;
  }
}
