/**
 * Editor AcceleratorPort adapter — delegates to Electron menu accelerator IPC events.
 *
 * Each accelerator fires an IPC event from the main process menu when the user
 * presses a keyboard shortcut. This adapter wraps `window.bridge.*` listener
 * registrations and returns an Unsubscribe function that deactivates the callback.
 *
 * Note: Electron's `ipcRenderer.on` only supports `removeAllListeners(channel)`,
 * not per-listener removal. We use an active flag so that unsubscribing prevents
 * the callback from firing without removing all listeners on the channel.
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
      let active = true
      window.bridge.createProjectAccelerator(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onOpenProject(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.handleOpenProjectRequest(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onOpenRecent(callback: (projectData?: unknown) => void): Unsubscribe {
      let active = true
      window.bridge.openRecentAccelerator((_event: unknown, response: unknown) => {
        if (active) callback(response)
      })
      return () => {
        active = false
      }
    },

    onSaveProject(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.saveProjectAccelerator(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onSaveFile(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.saveFileAccelerator(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onCloseProject(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.closeProjectAccelerator(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onExportProject(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.exportProjectRequest(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onCloseTab(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.closeTabAccelerator(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onDeleteFile(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.deleteFileAccelerator(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onFindInProject(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.findInProjectAccelerator(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onUndo(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.handleUndoRequest(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onRedo(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.handleRedoRequest(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onSwitchPerspective(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.switchPerspective(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onAbout(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.aboutModalAccelerator(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },

    onQuitApp(callback: () => void): Unsubscribe {
      let active = true
      window.bridge.quitAppRequest(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    },
  }
}
