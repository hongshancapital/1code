import { app, dialog, type BrowserWindow, type MenuItemConstructorOptions } from "electron"
import { isCliInstalled, installCli, uninstallCli } from "./cli"
import { createWindow } from "../windows/main"

export interface HongMenuOptions {
  /** Get the currently focused Hong window */
  getWindow: () => BrowserWindow | null
  /** Show DevTools menu item (dev mode or user-unlocked) */
  showDevTools?: boolean
  /** Callback after menu-affecting state changes (e.g. CLI install) — caller should rebuild menu */
  onMenuChanged?: () => void
  /** Override "New Window" action (default: createWindow from windows/main) */
  onNewWindow?: () => void
}

/**
 * Build Hong application menu template.
 * Shared between standalone mode (1code) and embedded mode (Tinker).
 * Returns MenuItemConstructorOptions[] — caller does Menu.buildFromTemplate() + setApplicationMenu().
 */
export function buildHongMenuTemplate(options: HongMenuOptions): MenuItemConstructorOptions[] {
  const { getWindow, showDevTools = false, onMenuChanged, onNewWindow } = options

  return [
    {
      label: app.name,
      submenu: [
        { role: "about", label: "About Hong" },
        { type: "separator" },
        {
          label: isCliInstalled()
            ? "Uninstall 'hong' Command..."
            : "Install 'hong' Command in PATH...",
          click: async () => {
            if (isCliInstalled()) {
              const result = await uninstallCli()
              if (result.success) {
                dialog.showMessageBox({
                  type: "info",
                  message: "CLI command uninstalled",
                  detail: "The 'hong' command has been removed from your PATH.",
                })
                onMenuChanged?.()
              } else {
                dialog.showErrorBox("Uninstallation Failed", result.error || "Unknown error")
              }
            } else {
              const result = await installCli()
              if (result.success) {
                dialog.showMessageBox({
                  type: "info",
                  message: "CLI command installed",
                  detail:
                    "You can now use 'hong .' in any terminal to open Hong in that directory.",
                })
                onMenuChanged?.()
              } else {
                dialog.showErrorBox("Installation Failed", result.error || "Unknown error")
              }
            }
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            const win = getWindow()
            if (win) {
              win.webContents.send("shortcut:new-agent")
            }
          },
        },
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            if (onNewWindow) {
              onNewWindow()
            } else {
              createWindow()
            }
          },
        },
        { type: "separator" },
        {
          label: "Close Window",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            const win = getWindow()
            if (win) {
              win.close()
            }
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "forceReload" },
        ...(showDevTools
          ? [
              {
                label: "Toggle Developer Tools",
                click: (_menuItem: unknown, browserWindow: BrowserWindow | undefined) => {
                  browserWindow?.webContents.toggleDevTools()
                },
              },
            ]
          : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ]
}
