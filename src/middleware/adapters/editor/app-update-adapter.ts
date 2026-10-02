/**
 * Editor AppUpdatePort adapter — the main-process update service
 * (`src/main/modules/updater`) over IPC.
 *
 * IPC channels used:
 *   - app-update:get-status (invoke) — the status now
 *   - app-update:status     (on)     — each change
 *   - app-update:install    (send)   — the status bar's "Update" button
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

    installAndRestart() {
      window.bridge.appUpdateInstall()
    },
  }
}
