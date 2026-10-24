import type { OpenPLCStore } from '../store'

/**
 * Marks the open tabs among `tabNames` unsaved and returns a function that marks saved again
 * the ones this call changed, for a pending change that turns out to change nothing.
 */
export function markTabsUnsaved(store: OpenPLCStore, tabNames: readonly string[]): () => void {
  const { fileActions } = store.getState()
  const marked = tabNames.filter((name) => fileActions.getFile({ name }).file?.saved === true)
  for (const name of marked) fileActions.updateFile({ name, saved: false })
  return () => {
    for (const name of marked) store.getState().fileActions.updateFile({ name, saved: true })
  }
}
