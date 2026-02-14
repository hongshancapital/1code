/**
 * Hong Extension System - 统一导出
 */

// 核心类型
export type {
  HookMode,
  HookDefinition,
  HookMap,
  HookInputOf,
  HookOutputOf,
  HookModeOf,
  HookHandler,
  HookResult,
  HookHandlerOptions,
  IHookRegistry,
  EventType,
  EventDefinition,
  FeatureBusEvents,
  EventArgs,
  EventResponse,
  GetEventType,
  RequestEvents,
  NotifyEvents,
  BroadcastEvents,
  IFeatureBus,
  ExtensionContext,
  ExtensionModule,
} from "./types"

// HookRegistry
export { HookRegistry, registerHookMode } from "./hook-registry"

// FeatureBus
export { FeatureBus } from "./feature-bus"

// ExtensionManager
export {
  ExtensionManager,
  getExtensionManager,
  getHooks,
  getBus,
} from "./extension-manager"
