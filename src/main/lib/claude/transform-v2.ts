import type { UIMessageChunk } from "./types";

// 导入所有组件
import { IdManager } from "./transform/id-manager";
import { StateManager } from "./transform/state-manager";
import { TextStreamTracker } from "./transform/trackers/text-stream-tracker";
import { ToolStreamTracker } from "./transform/trackers/tool-stream-tracker";
import { ThinkingStreamTracker } from "./transform/trackers/thinking-stream-tracker";
import { ToolRegistry } from "./transform/enhancers/tool-registry";
import { BashEnhancer } from "./transform/enhancers/bash-enhancer";
import { SystemCompactEnhancer } from "./transform/enhancers/system-compact-enhancer";
import { StreamEventHandler } from "./transform/handlers/stream-event-handler";
import { AssistantHandler } from "./transform/handlers/assistant-handler";
import { UserHandler } from "./transform/handlers/user-handler";
import { SystemHandler } from "./transform/handlers/system-handler";
import { TransformOrchestrator } from "./transform/orchestrator";

/**
 * 创建消息转换器（重构版）
 *
 * 将 SDK 消息流转换为 UI 可消费的 UIMessageChunk 流
 *
 * @param options.emitSdkMessageUuid - 是否在 metadata 中包含 SDK message UUID
 * @param options.isUsingOllama - 是否使用 Ollama（影响日志输出）
 * @returns 转换器函数（generator）
 */
export function createTransformer(options?: {
  emitSdkMessageUuid?: boolean;
  isUsingOllama?: boolean;
}) {
  const emitSdkMessageUuid = options?.emitSdkMessageUuid === true;
  const isUsingOllama = options?.isUsingOllama === true;

  // ===== 初始化核心组件 =====
  const idManager = new IdManager();
  const stateManager = new StateManager();

  // ===== 初始化 StreamTrackers =====
  const textTracker = new TextStreamTracker();
  const toolTracker = new ToolStreamTracker();
  const thinkingTracker = new ThinkingStreamTracker();

  // ===== 初始化 ToolRegistry + Enhancers =====
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new BashEnhancer());
  // 可在此添加更多 enhancers

  // ===== 初始化 SystemCompactEnhancer =====
  const compactEnhancer = new SystemCompactEnhancer();

  // ===== 初始化 Handlers =====
  const streamEventHandler = new StreamEventHandler(
    textTracker,
    toolTracker,
    thinkingTracker,
    idManager,
    stateManager,
    toolRegistry,
    isUsingOllama,
  );

  const assistantHandler = new AssistantHandler(
    textTracker,
    toolTracker,
    idManager,
    stateManager,
    toolRegistry,
  );

  const userHandler = new UserHandler(idManager, toolRegistry, stateManager);

  const systemHandler = new SystemHandler(compactEnhancer);

  // ===== 初始化 Orchestrator =====
  const orchestrator = new TransformOrchestrator(
    streamEventHandler,
    assistantHandler,
    userHandler,
    systemHandler,
    stateManager,
    { emitSdkMessageUuid, isUsingOllama },
  );

  // ===== 返回 generator 函数（向后兼容接口）=====
  return function* transform(msg: any): Generator<UIMessageChunk> {
    yield* orchestrator.process(msg);
  };
}
