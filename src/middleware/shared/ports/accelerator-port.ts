/**
 * AcceleratorPort — Abstracts keyboard shortcuts and application-level actions.
 *
 * Editor adapter: Registers IPC event listeners for Electron menu accelerators.
 *                 Each accelerator fires an IPC event from the main process menu.
 * Web adapter:    Registers browser keyboard event listeners (e.g., Ctrl+S, Ctrl+Z).
 *                 Shortcuts handled via useSaveShortcut, useUndoRedoShortcut hooks.
 *
 * This port provides a uniform way for the shared UI to subscribe to
 * application-level actions without knowing the platform mechanism.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.createProjectAccelerator()
 *   - window.bridge.handleOpenProjectRequest()
 *   - window.bridge.openRecentAccelerator()
 *   - window.bridge.saveProjectAccelerator()
 *   - window.bridge.saveFileAccelerator()
 *   - window.bridge.closeProjectAccelerator()
 *   - window.bridge.closeTabAccelerator()
 *   - window.bridge.deleteFileAccelerator()
 *   - window.bridge.exportProjectRequest()
 *   - window.bridge.findInProjectAccelerator()
 *   - window.bridge.handleUndoRequest()
 *   - window.bridge.handleRedoRequest()
 *   - window.bridge.switchPerspective()
 *   - window.bridge.aboutAccelerator()
 *   - window.bridge.aboutModalAccelerator()
 *   - All corresponding remove*Listener() methods
 *
 * ## Web equivalents:
 *   - useSaveShortcut hook (Ctrl+S)
 *   - useUndoRedoShortcut hook (Ctrl+Z, Ctrl+Shift+Z)
 *   - Browser keyboard event listeners
 */

import type { Unsubscribe } from './types'

export interface AcceleratorPort {
  // --- Project actions ---
  onCreateProject(callback: () => void): Unsubscribe
  onOpenProject(callback: () => void): Unsubscribe
  onOpenRecent(callback: (projectData?: unknown) => void): Unsubscribe
  onSaveProject(callback: () => void): Unsubscribe
  onSaveFile(callback: () => void): Unsubscribe
  onCloseProject(callback: () => void): Unsubscribe
  onExportProject(callback: () => void): Unsubscribe

  // --- Editor actions ---
  onCloseTab(callback: () => void): Unsubscribe
  onDeleteFile(callback: () => void): Unsubscribe
  onFindInProject(callback: () => void): Unsubscribe
  onUndo(callback: () => void): Unsubscribe
  onRedo(callback: () => void): Unsubscribe

  // --- View actions ---
  onSwitchPerspective(callback: () => void): Unsubscribe
  onAbout(callback: () => void): Unsubscribe

  // --- App lifecycle ---
  onQuitApp(callback: () => void): Unsubscribe
}
