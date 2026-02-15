/**
 * Runner Extension
 *
 * 将脚本运行器（Runtime 检测 + 脚本执行）功能封装为 Extension。
 * 实现文件保留在 lib/runtime/，此处为轻量 wrapper 提供 router。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { runnerRouter } from "../../lib/trpc/routers/runner"

class RunnerExtension implements ExtensionModule {
  name = "runner" as const
  description = "Runtime detection and script execution"
  router = runnerRouter
}

export const runnerExtension = new RunnerExtension()
