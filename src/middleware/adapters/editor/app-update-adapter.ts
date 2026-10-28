/**
 * Editor AppUpdatePort adapter — the main-process update service
 * (`src/main/modules/updater`) over IPC.
 *
 * IPC channels used:
 *   - app-update:get-status (invoke) — the status now
 *   - app-update:status     (on)     — each change
 *   - app-update:download   (send)   — the banner's "Update" button
 *   - app-update:dismiss    (send)   — the banner's X
 *   - app-update:check      (send)   — File > Check for Updates
 *   - app-update:get-auto-check / app-update:set-auto-check — File > Check for Updates Automatically
 */

import { type AppUpdatePort, toAppUpdateStatus } from '../../shared/ports/app-update-port'

export function createEditorAppUpdateAdapter(): AppUpdatePort {
  return {
    async getStatus() {
      return toAppUpdateStatus(await window.bridge.appUpdateGetStatus())
    },

    onStatusChanged(callback) {
      return window.bridge.onAppUpdateStatus((status) => callback(toAppUpdateStatus(status)))
    },

    downloadAndOpen() {
      window.bridge.appUpdateDownload()
    },

    dismiss() {
      window.bridge.appUpdateDismiss()
    },

    checkNow() {
      window.bridge.appUpdateCheck()
    },

    async isAutoCheckEnabled() {
      return (await window.bridge.appUpdateGetAutoCheck()) === true
    },

    setAutoCheck(enabled) {
      window.bridge.appUpdateSetAutoCheck(enabled)
    },
  }
}
