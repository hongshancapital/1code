import type { UIMessageChunk } from "./types";
import { createTransformer as createTransformerV1 } from "./transform";
import { createTransformer as createTransformerV2 } from "./transform-v2";

/**
 * Transform 版本选择
 *
 * 通过环境变量控制使用哪个版本：
 * - USE_TRANSFORM_V2=true → 使用新版重构实现
 * - USE_TRANSFORM_V2=false 或未设置 → 使用旧版实现（默认）
 */
const USE_TRANSFORM_V2 =
  process.env.USE_TRANSFORM_V2 === "true" ||
  process.env.USE_TRANSFORM_V2 === "1";

/**
 * 创建消息转换器（带版本切换）
 *
 * @param options.emitSdkMessageUuid - 是否在 metadata 中包含 SDK message UUID
 * @param options.isUsingOllama - 是否使用 Ollama
 * @returns 转换器函数
 */
export function createTransformer(options?: {
  emitSdkMessageUuid?: boolean;
  isUsingOllama?: boolean;
}): (msg: any) => Generator<UIMessageChunk> {
  if (USE_TRANSFORM_V2) {
    console.log("[Transform] Using V2 (refactored implementation)");
    return createTransformerV2(options);
  } else {
    console.log("[Transform] Using V1 (legacy implementation)");
    return createTransformerV1(options);
  }
}

/**
 * 直接导出两个版本（用于测试对比）
 */
export { createTransformerV1, createTransformerV2 };
