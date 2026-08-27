import { useOpenPLCStore } from '../store'

/** Tab name, path and model the Package Manager screen is registered under. */
const PACKAGE_MANAGER_TAB_NAME = 'Package Manager'

/**
 * Open the Package Manager, or focus it when it is already open.
 *
 * Reached from three places — the device board dropdown, the library Build
 * Settings core dropdown, and the main-process "open manager" event — so the
 * tab/model registration lives here rather than being repeated at each.
 */
export function openPackageManagerTab(): void {
  const { tabsActions, editorActions } = useOpenPLCStore.getState()
  const tab = {
    name: PACKAGE_MANAGER_TAB_NAME,
    path: '/package-manager',
    elementType: { type: 'package-manager' as const },
  }
  tabsActions.updateTabs(tab)
  const existing = editorActions.getEditorFromEditors(tab.name)
  if (existing) {
    editorActions.setEditor(existing)
    return
  }
  const model = { type: 'plc-package-manager' as const, meta: { name: PACKAGE_MANAGER_TAB_NAME } }
  editorActions.addModel(model)
  editorActions.setEditor(model)
}
