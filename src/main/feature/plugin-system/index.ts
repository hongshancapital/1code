/**
 * Plugin System Extension
 *
 * 将插件系统（发现、安装、Marketplace、Skills、Commands）封装为 Extension。
 * 涵盖 4 个 Router：plugins, marketplace, skills, commands。
 * 实现文件保留在 lib/plugins/，此处为轻量 wrapper 提供 router 聚合。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { pluginsRouter } from "../../lib/trpc/routers/plugins"
import { marketplaceRouter } from "../../lib/trpc/routers/marketplace"
import { skillsRouter } from "../../lib/trpc/routers/skills"
import { commandsRouter } from "../../lib/trpc/routers/commands"

class PluginSystemExtension implements ExtensionModule {
  name = "plugin-system" as const
  description = "Plugin discovery, marketplace, skills, and commands"

  routers = {
    plugins: pluginsRouter,
    marketplace: marketplaceRouter,
    skills: skillsRouter,
    commands: commandsRouter,
  }
}

export const pluginSystemExtension = new PluginSystemExtension()
