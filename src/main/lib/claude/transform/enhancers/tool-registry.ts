import type { ToolEnhancer, ToolContext, ToolOutputContext } from "../interfaces";
import type { UIMessageChunk } from "../../types";

/**
 * 工具注册表：管理可插拔的工具增强器
 *
 * 职责：
 * 1. 注册工具增强器 (按优先级排序)
 * 2. 匹配工具名到增强器
 * 3. 调用增强器回调 (onInputComplete, enhanceOutput)
 */
export class ToolRegistry {
  private enhancers: ToolEnhancer[] = [];

  /**
   * 注册工具增强器
   */
  register(enhancer: ToolEnhancer): void {
    this.enhancers.push(enhancer);
    // 按优先级排序 (数字越小越优先)
    this.enhancers.sort((a, b) => {
      const priorityA = a.priority ?? 100;
      const priorityB = b.priority ?? 100;
      return priorityA - priorityB;
    });
  }

  /**
   * 查找匹配的增强器
   */
  findEnhancers(toolName: string): ToolEnhancer[] {
    return this.enhancers.filter((e) => e.matches(toolName));
  }

  /**
   * 触发 onInputComplete 回调
   */
  notifyInputComplete(context: ToolContext): void {
    const matchedEnhancers = this.findEnhancers(context.toolName);
    for (const enhancer of matchedEnhancers) {
      if (enhancer.onInputComplete) {
        enhancer.onInputComplete(context);
      }
    }
  }

  /**
   * 收集增强输出 chunk
   */
  *collectEnhancedOutput(
    context: ToolOutputContext,
  ): Generator<UIMessageChunk> {
    const matchedEnhancers = this.findEnhancers(context.toolName);
    for (const enhancer of matchedEnhancers) {
      if (enhancer.enhanceOutput) {
        const chunks = enhancer.enhanceOutput(context);
        yield* chunks;
      }
    }
  }

  /**
   * 获取所有已注册的增强器 (用于测试)
   */
  getEnhancers(): ToolEnhancer[] {
    return [...this.enhancers];
  }

  /**
   * 清空注册表 (用于测试)
   */
  clear(): void {
    this.enhancers = [];
  }
}
