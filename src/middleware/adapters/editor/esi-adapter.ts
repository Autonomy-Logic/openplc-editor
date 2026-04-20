/**
 * Editor EsiPort adapter — delegates to Electron IPC bridge.
 *
 * Communicates with the main process ESIService for ESI repository
 * management. The adapter injects the project path from a callback
 * so UI components never pass it explicitly.
 *
 * IPC channels:
 *   esi:load-repository-light   (invoke)
 *   esi:migrate-repository      (invoke)
 *   esi:parse-and-save-file     (invoke)
 *   esi:delete-xml-file         (invoke)
 *   esi:clear-repository        (invoke)
 *   esi:load-device-full        (invoke)
 */

import type { EsiPort } from '../../shared/ports/esi-port'
import type { Result } from '../../shared/ports/types'

export function createEditorEsiAdapter(getProjectPath: () => string): EsiPort {
  function requireProjectPath(): string {
    const path = getProjectPath()
    if (!path) throw new Error('No project path available')
    return path
  }

  return {
    async loadRepositoryLight() {
      try {
        const projectPath = requireProjectPath()
        const result = await window.bridge.esiLoadRepositoryLight(projectPath)
        if (result.success) {
          return { success: true, items: result.items ?? [], needsMigration: result.needsMigration } as Result<{
            items: typeof result.items extends undefined ? never : NonNullable<typeof result.items>
            needsMigration?: boolean
          }>
        }
        return { success: false, error: result.error ?? 'Failed to load repository' }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },

    async migrateRepository() {
      try {
        const projectPath = requireProjectPath()
        const result = await window.bridge.esiMigrateRepository(projectPath)
        if (result.success) {
          return { success: true, items: result.items ?? [] } as Result<{
            items: NonNullable<typeof result.items>
          }>
        }
        return { success: false, error: result.error ?? 'Migration failed' }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },

    async parseAndSaveFile(filename, content) {
      try {
        const projectPath = requireProjectPath()
        const result = await window.bridge.esiParseAndSaveFile(projectPath, filename, content)
        if (result.success && result.item) {
          return { success: true, item: result.item }
        }
        if (result.success) {
          // Duplicate file — surface it explicitly so callers can distinguish
          // a successful add from a silent skip instead of squinting at `!item`.
          return { success: true, duplicate: true }
        }
        return { success: false, error: result.error ?? 'Parse failed' }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },

    async deleteRepositoryItem(itemId) {
      try {
        const projectPath = requireProjectPath()
        const result = await window.bridge.esiDeleteXmlFile(projectPath, itemId)
        return result.success
          ? ({ success: true } as Result)
          : { success: false, error: result.error ?? 'Delete failed' }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },

    async clearRepository() {
      try {
        const projectPath = requireProjectPath()
        const result = await window.bridge.esiClearRepository(projectPath)
        return result.success
          ? ({ success: true } as Result)
          : { success: false, error: result.error ?? 'Clear failed' }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },

    async loadDeviceFull(itemId, deviceIndex) {
      try {
        const projectPath = requireProjectPath()
        const result = await window.bridge.esiLoadDeviceFull(projectPath, itemId, deviceIndex)
        if (result.success && result.device) {
          return { success: true, device: result.device } as Result<{ device: NonNullable<typeof result.device> }>
        }
        return { success: false, error: result.error ?? 'Device not found' }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  }
}
