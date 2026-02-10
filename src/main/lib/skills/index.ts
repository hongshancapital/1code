import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { app } from "electron"

/**
 * Metadata stored in .hong marker file (JSON format)
 * Legacy empty .hong files are treated as builtin source for backward compatibility
 */
interface HongMarker {
  source: "builtin" | "plugin"
  pluginSource?: string
  originPath: string
  installedAt: string
}

/**
 * Unified SkillManager - centralizes all skill install/uninstall/sync operations.
 *
 * Manages the ~/.claude/skills/ directory to make skills discoverable by Claude SDK.
 * Skills are identified by .hong marker files to distinguish managed skills from user-created ones.
 *
 * Directory naming:
 * - builtin:  builtin-{name}
 * - plugin:   plugin-{sanitizedSource}-{name}
 * - user:     no prefix (user-created, not managed)
 * - project:  not installed here (SDK reads from project .claude/skills/ directly)
 */
export class SkillManager {
  private userSkillsDir = path.join(os.homedir(), ".claude", "skills")

  // ──────────────────────────────────────────────
  // Core install / uninstall
  // ──────────────────────────────────────────────

  /**
   * Install a single skill to ~/.claude/skills/{prefix}-{name}/
   * Copies the entire skill directory and writes a .hong marker.
   * @returns the installed directory name
   */
  async installSkill(params: {
    source: "builtin" | "plugin"
    originDir: string
    skillName: string
    pluginSource?: string
  }): Promise<string> {
    const dirName = this.getInstalledDirName(params.source, params.skillName, params.pluginSource)
    const targetDir = path.join(this.userSkillsDir, dirName)

    await fs.mkdir(this.userSkillsDir, { recursive: true })

    // Clean target first
    await fs.rm(targetDir, { recursive: true, force: true })

    // Copy entire skill directory
    await this.copyDirectory(params.originDir, targetDir)

    // Write .hong marker with metadata
    await this.writeHongMarker(targetDir, {
      source: params.source,
      pluginSource: params.pluginSource,
      originPath: params.originDir,
      installedAt: new Date().toISOString(),
    })

    return dirName
  }

  /**
   * Uninstall a managed skill (only removes directories with .hong marker)
   */
  async uninstallSkill(installedDirName: string): Promise<void> {
    const targetDir = path.join(this.userSkillsDir, installedDirName)

    if (!(await this.isHongManaged(targetDir))) {
      console.warn(`[SkillManager] Refusing to uninstall non-managed skill: ${installedDirName}`)
      return
    }

    await fs.rm(targetDir, { recursive: true, force: true })
  }

  // ──────────────────────────────────────────────
  // Batch operations
  // ──────────────────────────────────────────────

  /**
   * Sync all builtin skills on app startup.
   * Migrated from syncBuiltinSkillsToUserDir() in skills.ts.
   * - Installs/updates all non-hidden builtin skills
   * - Removes builtin skills that are hidden or no longer exist
   */
  async syncAllBuiltinSkills(): Promise<void> {
    const builtinSkillsDir = this.getBuiltinSkillsPath()

    try {
      await fs.access(builtinSkillsDir)
    } catch {
      console.log("[SkillManager] No builtin skills directory found")
      return
    }

    await fs.mkdir(this.userSkillsDir, { recursive: true })

    const entries = await fs.readdir(builtinSkillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const skillName = entry.name
      const sourceDir = path.join(builtinSkillsDir, skillName)
      const installedDirName = `builtin-${skillName}`
      const targetDir = path.join(this.userSkillsDir, installedDirName)

      try {
        // Verify SKILL.md exists
        await fs.access(path.join(sourceDir, "SKILL.md"))

        // Check if skill is hidden via hong.yaml
        if (await this.isSkillHidden(sourceDir)) {
          await fs.rm(targetDir, { recursive: true, force: true })
          console.log(`[SkillManager] Removed hidden builtin skill: ${skillName}`)
          continue
        }

        // Install (overwrite existing)
        await fs.rm(targetDir, { recursive: true, force: true })
        await this.copyDirectory(sourceDir, targetDir)
        await this.writeHongMarker(targetDir, {
          source: "builtin",
          originPath: sourceDir,
          installedAt: new Date().toISOString(),
        })

        console.log(`[SkillManager] Synced builtin skill: ${skillName}`)
      } catch (err) {
        console.warn(`[SkillManager] Failed to sync builtin skill ${skillName}:`, err)
      }
    }
  }

  /**
   * Install all skills from a plugin's skills/ directory.
   * Called when a plugin is enabled.
   */
  async syncPluginSkills(pluginSource: string, pluginPath: string): Promise<void> {
    const skillsDir = path.join(pluginPath, "skills")

    try {
      await fs.access(skillsDir)
    } catch {
      // Plugin has no skills/ directory - nothing to sync
      return
    }

    await fs.mkdir(this.userSkillsDir, { recursive: true })

    const entries = await fs.readdir(skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const skillDir = path.join(skillsDir, entry.name)

      try {
        // Verify SKILL.md exists
        await fs.access(path.join(skillDir, "SKILL.md"))

        // Check if skill is hidden
        if (await this.isSkillHidden(skillDir)) continue

        const dirName = await this.installSkill({
          source: "plugin",
          originDir: skillDir,
          skillName: entry.name,
          pluginSource,
        })

        console.log(`[SkillManager] Installed plugin skill: ${dirName}`)
      } catch (err) {
        console.warn(`[SkillManager] Failed to install plugin skill ${entry.name} from ${pluginSource}:`, err)
      }
    }
  }

  /**
   * Remove all installed skills belonging to a plugin.
   * Called when a plugin is disabled.
   */
  async removePluginSkills(pluginSource: string): Promise<void> {
    try {
      await fs.access(this.userSkillsDir)
    } catch {
      return
    }

    const entries = await fs.readdir(this.userSkillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (!entry.name.startsWith("plugin-")) continue

      const dir = path.join(this.userSkillsDir, entry.name)
      const marker = await this.readHongMarker(dir)

      if (marker && marker.pluginSource === pluginSource) {
        try {
          await fs.rm(dir, { recursive: true, force: true })
          console.log(`[SkillManager] Removed plugin skill: ${entry.name}`)
        } catch (err) {
          console.warn(`[SkillManager] Failed to remove plugin skill ${entry.name}:`, err)
        }
      }
    }
  }

  // ──────────────────────────────────────────────
  // Single skill enable / disable
  // ──────────────────────────────────────────────

  /**
   * Enable a skill by installing it to the filesystem.
   * Replaces syncBuiltinSkillEnabled(name, true).
   */
  async enableSkill(
    skillName: string,
    source: "builtin" | "plugin",
    originDir: string,
    pluginSource?: string,
  ): Promise<void> {
    try {
      await fs.access(path.join(originDir, "SKILL.md"))
    } catch {
      console.warn(`[SkillManager] Skill origin not found: ${originDir}`)
      return
    }

    const dirName = await this.installSkill({ source, originDir, skillName, pluginSource })
    console.log(`[SkillManager] Enabled skill: ${dirName}`)
  }

  /**
   * Disable a skill by removing it from the filesystem.
   * Replaces syncBuiltinSkillEnabled(name, false).
   * Only removes .hong-managed directories.
   */
  async disableSkill(installedDirName: string): Promise<void> {
    await this.uninstallSkill(installedDirName)
    console.log(`[SkillManager] Disabled skill: ${installedDirName}`)
  }

  /**
   * Resolve the origin directory for a skill given its installed name.
   * Used when re-enabling a skill by name.
   */
  async resolveOriginDir(skillName: string): Promise<{ source: "builtin" | "plugin"; originDir: string; pluginSource?: string } | null> {
    // Check builtin source
    if (skillName.startsWith("builtin-")) {
      const originalName = skillName.slice("builtin-".length)
      const builtinDir = path.join(this.getBuiltinSkillsPath(), originalName)
      try {
        await fs.access(path.join(builtinDir, "SKILL.md"))
        return { source: "builtin", originDir: builtinDir }
      } catch {
        return null
      }
    }

    // Check if there's an existing .hong marker with originPath
    if (skillName.startsWith("plugin-")) {
      const targetDir = path.join(this.userSkillsDir, skillName)
      const marker = await this.readHongMarker(targetDir)
      if (marker) {
        return { source: "plugin", originDir: marker.originPath, pluginSource: marker.pluginSource }
      }
    }

    return null
  }

  // ──────────────────────────────────────────────
  // Internal utilities
  // ──────────────────────────────────────────────

  /**
   * Generate the installed directory name based on source and skill name.
   */
  private getInstalledDirName(source: "builtin" | "plugin", skillName: string, pluginSource?: string): string {
    if (source === "builtin") {
      return `builtin-${skillName}`
    }
    // Plugin: sanitize pluginSource for use in directory name
    const sanitized = this.sanitizeForDirName(pluginSource || "unknown")
    return `plugin-${sanitized}-${skillName}`
  }

  /**
   * Sanitize a string for use as part of a directory name.
   * Replaces @, :, / and other special chars with -, truncates to 40 chars.
   */
  private sanitizeForDirName(str: string): string {
    return str
      .replace(/[@:\/\\]/g, "-")
      .replace(/[^a-zA-Z0-9\-_.]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
  }

  /**
   * Recursively copy a directory. Migrated from copyDirectoryRecursive in skills.ts.
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true })

    const entries = await fs.readdir(src, { withFileTypes: true })

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath)
      } else {
        await fs.copyFile(srcPath, destPath)
      }
    }
  }

  /**
   * Check if a directory is managed by Hong (has .hong marker).
   */
  private async isHongManaged(dir: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, ".hong"))
      return true
    } catch {
      return false
    }
  }

  /**
   * Write .hong marker file with JSON metadata.
   */
  private async writeHongMarker(dir: string, metadata: HongMarker): Promise<void> {
    await fs.writeFile(
      path.join(dir, ".hong"),
      JSON.stringify(metadata, null, 2),
      "utf-8",
    )
  }

  /**
   * Read .hong marker file. Returns null if not found or invalid.
   * Backward compatible: empty files are treated as legacy builtin markers.
   */
  private async readHongMarker(dir: string): Promise<HongMarker | null> {
    try {
      const content = await fs.readFile(path.join(dir, ".hong"), "utf-8")
      if (!content.trim()) {
        // Legacy empty .hong file - treat as builtin
        return { source: "builtin", originPath: "", installedAt: "" }
      }
      return JSON.parse(content) as HongMarker
    } catch {
      return null
    }
  }

  /**
   * Check if a skill is hidden via hong.yaml interface config.
   */
  private async isSkillHidden(skillDir: string): Promise<boolean> {
    try {
      const hongYamlPath = path.join(skillDir, "agents", "hong.yaml")
      const content = await fs.readFile(hongYamlPath, "utf-8")
      // Simple YAML parse - look for hidden: true
      const { default: YAML } = await import("yaml")
      const parsed = YAML.parse(content)
      return parsed?.interface?.hidden === true
    } catch {
      return false
    }
  }

  /**
   * Get the builtin skills directory path.
   * Reuses logic from getBuiltinSkillsPath() in skills.ts.
   */
  private getBuiltinSkillsPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "skills")
    }
    // Development: __dirname is out/main, go up 2 levels to project root
    return path.join(__dirname, "../../resources/skills")
  }
}

// Singleton
let _instance: SkillManager | null = null

export function getSkillManager(): SkillManager {
  if (!_instance) {
    _instance = new SkillManager()
  }
  return _instance
}
