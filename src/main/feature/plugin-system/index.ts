/**
 * Plugin System Extension
 *
 * 插件发现、Marketplace、Skills、Commands。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { pluginsRouter } from "./routers/plugins"
import { marketplaceRouter } from "./routers/marketplace"
import { skillsRouter } from "./routers/skills"
import { commandsRouter } from "./routers/commands"

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
