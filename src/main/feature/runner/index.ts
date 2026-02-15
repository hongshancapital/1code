/**
 * Runner Extension
 *
 * Runtime 检测 + 脚本执行。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { runnerRouter } from "./router"

class RunnerExtension implements ExtensionModule {
  name = "runner" as const
  description = "Runtime detection and script execution"
  router = runnerRouter
}

export const runnerExtension = new RunnerExtension()
