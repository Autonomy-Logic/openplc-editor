/**
 * Editor AcceleratorPort adapter — delegates to Electron menu accelerator IPC events.
 *
 * Each accelerator fires an IPC event from the main process menu when the user
 * presses a keyboard shortcut. This adapter wraps `window.bridge.*` listener
 * registrations and returns the bridge's own Unsubscribe.
 *
 * Note: every `window.bridge.*Accelerator` registration returns a real
 * per-listener disposer (`ipcRenderer.removeListener` with the exact wrapped
 * function — see the `subscribe` helper in `src/main/modules/ipc/renderer.ts`).
 * Returning it verbatim is what keeps the IPC listener count flat: the
 * subscribing effects in `accelerator-handler.tsx` re-run on every dependency
 * change, so a no-op unsubscribe would leak one listener per re-run.
 *
 * IPC channels:
 *   project:create-accelerator
 *   project:open-project-request
 *   project:open-recent-accelerator
 *   project:save-accelerator
 *   project:save-file-accelerator
 *   workspace:close-project-accelerator
 *   compiler:export-project-request
 *   workspace:close-tab-accelerator
 *   workspace:delete-file-accelerator
 *   project:find-in-project-accelerator
 *   edit:undo-request
 *   edit:redo-request
 *   workspace:switch-perspective-accelerator
 *   about:open-accelerator
 */

import type { AcceleratorPort } from '../../shared/ports/accelerator-port'
import type { Unsubscribe } from '../../shared/ports/types'

export function createEditorAcceleratorAdapter(): AcceleratorPort {
  return {
    onCreateProject(callback: () => void): Unsubscribe {
      return window.bridge.createProjectAccelerator(() => callback())
    },

    onOpenProject(callback: () => void): Unsubscribe {
      return window.bridge.handleOpenProjectRequest(() => callback())
    },

    onOpenRecent(callback: (projectData?: unknown) => void): Unsubscribe {
      return window.bridge.openRecentAccelerator((_event: unknown, response: unknown) => callback(response))
    },

    onSaveProject(callback: () => void): Unsubscribe {
      return window.bridge.saveProjectAccelerator(() => callback())
    },

    onSaveProjectAs(callback: () => void): Unsubscribe {
      return window.bridge.saveProjectAsAccelerator(() => callback())
    },

    onSaveFile(callback: () => void): Unsubscribe {
      return window.bridge.saveFileAccelerator(() => callback())
    },

    onCloseProject(callback: () => void): Unsubscribe {
      return window.bridge.closeProjectAccelerator(() => callback())
    },

    onExportProject(callback: (format?: 'old-editor' | 'codesys') => void): Unsubscribe {
      return window.bridge.exportProjectRequest((_event: unknown, format: unknown) =>
        callback(format === 'codesys' ? 'codesys' : 'old-editor'),
      )
    },

    onImportProject(callback: () => void): Unsubscribe {
      return window.bridge.importProjectRequest(() => callback())
    },

    onCloseTab(callback: () => void): Unsubscribe {
      return window.bridge.closeTabAccelerator(() => callback())
    },

    onDeleteFile(callback: () => void): Unsubscribe {
      return window.bridge.deleteFileAccelerator(() => callback())
    },

    onFindInProject(callback: () => void): Unsubscribe {
      return window.bridge.findInProjectAccelerator(() => callback())
    },

    onUndo(callback: () => void): Unsubscribe {
      return window.bridge.handleUndoRequest(() => callback())
    },

    onRedo(callback: () => void): Unsubscribe {
      return window.bridge.handleRedoRequest(() => callback())
    },

    onSwitchPerspective(callback: () => void): Unsubscribe {
      return window.bridge.switchPerspective(() => callback())
    },

    onAbout(callback: () => void): Unsubscribe {
      return window.bridge.aboutModalAccelerator(() => callback())
    },

    onQuitApp(callback: () => void): Unsubscribe {
      return window.bridge.quitAppRequest(() => callback())
    },
  }
}
