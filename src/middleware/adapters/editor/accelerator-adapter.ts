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

type BridgeListener = (callback: (...args: unknown[]) => void) => void

const subscribeBridgeEvent = (
  listener: BridgeListener | undefined,
  callback: (...args: unknown[]) => void,
  mapArgs: (...args: unknown[]) => unknown[] = () => [],
): Unsubscribe => {
  if (typeof listener !== 'function') {
    return () => {}
  }

  let active = true
  listener((...args: unknown[]) => {
    if (active) callback(...mapArgs(...args))
  })

  return () => {
    active = false
  }
}

export function createEditorAcceleratorAdapter(): AcceleratorPort {
  return {
    onCreateProject(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.createProjectAccelerator, callback)
    },

    onOpenProject(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.handleOpenProjectRequest, callback)
    },

    onOpenRecent(callback: (projectData?: unknown) => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.openRecentAccelerator, callback, (_event, response) => [response])
    },

    onSaveProject(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.saveProjectAccelerator, callback)
    },

    onSaveFile(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.saveFileAccelerator, callback)
    },

    onCloseProject(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.closeProjectAccelerator, callback)
    },

    onExportProject(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.exportProjectRequest, callback)
    },

    onCloseTab(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.closeTabAccelerator, callback)
    },

    onDeleteFile(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.deleteFileAccelerator, callback)
    },

    onFindInProject(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.findInProjectAccelerator, callback)
    },

    onUndo(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.handleUndoRequest, callback)
    },

    onRedo(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.handleRedoRequest, callback)
    },

    onSwitchPerspective(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.switchPerspective, callback)
    },

    onAbout(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.aboutModalAccelerator, callback)
    },

    onQuitApp(callback: () => void): Unsubscribe {
      return subscribeBridgeEvent(window.bridge?.quitAppRequest, callback)
    },
  }
}
