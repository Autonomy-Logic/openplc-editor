/**
 * Open the developer I/O image diagnostics tab.
 *
 * Shared by the two entry points because a desktop build has two menus and
 * shows one or the other: the React menu bar rides in the custom title bar
 * (macOS, Windows) while a framed window (Linux) gets Electron's native menu
 * instead. Both land here so the tab cannot open two different ways.
 *
 * The tab has no project element behind it, so it opens the way the package
 * manager does — straight into the tab list, not through the explorer tree.
 */

import { openPLCStoreBase } from '../../store'

export const DIAGNOSTICS_TAB_NAME = 'I/O Image Diagnostics'

export function openDiagnosticsTab(): void {
  const { tabsActions, editorActions } = openPLCStoreBase.getState()
  tabsActions.updateTabs({
    name: DIAGNOSTICS_TAB_NAME,
    path: '/diagnostics',
    elementType: { type: 'diagnostics' },
  })
  const existing = editorActions.getEditorFromEditors(DIAGNOSTICS_TAB_NAME)
  const model = existing ?? { type: 'plc-diagnostics' as const, meta: { name: DIAGNOSTICS_TAB_NAME } }
  if (!existing) editorActions.addModel(model)
  editorActions.setEditor(model)
}
