import { useOpenPLCStore } from '@root/frontend/store'
import { collectScreenPersistenceKeys } from '@root/frontend/utils/vpp/persistence-keys'
import { useEffect, useMemo } from 'react'

import { VendorScreenRenderer } from '../device/configuration/vendor-screen'

/**
 * Stable serialisation of the slice of `vendorScreenData` this screen
 * owns.  Sorted by key so insertion order doesn't matter for the
 * dirty-vs-clean compare.  This same shape goes into `cleanState` on
 * mount and on every successful save; "Don't save" parses it and
 * writes it back via the device slice's bulk setter.
 */
function serializeOwnedSlice(vendorScreenData: Record<string, unknown> | undefined, ownedKeys: string[]): string {
  const slice: Record<string, unknown> = {}
  for (const k of [...ownedKeys].sort()) {
    if (vendorScreenData && Object.prototype.hasOwnProperty.call(vendorScreenData, k)) {
      slice[k] = vendorScreenData[k]
    }
  }
  return JSON.stringify(slice)
}

const VendorScreenEditor = () => {
  const editor = useOpenPLCStore((s) => s.editor)
  const screenName = editor.type === 'plc-vendor-screen' ? editor.meta.screenName : ''
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const vendorScreenData = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const addFile = useOpenPLCStore((s) => s.fileActions.addFile)
  const updateFile = useOpenPLCStore((s) => s.fileActions.updateFile)
  const getFile = useOpenPLCStore((s) => s.fileActions.getFile)
  const boardInfo = availableBoards.get(deviceBoard)
  const screenDefinition = boardInfo?.vpp?.screens?.[screenName] ?? null
  const moduleSystem = boardInfo?.vpp?.moduleSystem ?? null

  const ownedKeys = useMemo(() => collectScreenPersistenceKeys(screenDefinition), [screenDefinition])

  // Register the file entry for this tab on mount so Ctrl+S, File →
  // Save, and the save-changes-file modal on close find it.
  // cleanState captures the slice this screen owns as it stood when
  // the tab opened — subsequent edits are compared against it for
  // the dirty flag, and "Don't save" restores it via the device
  // slice's bulk setter.  addFile is a no-op when an entry already
  // exists for the same name (re-opening keeps the prior cleanState).
  useEffect(() => {
    if (!screenName || !screenDefinition) return
    addFile({
      name: screenName,
      type: 'vendor-screen',
      filePath: '',
      cleanState: serializeOwnedSlice(vendorScreenData, ownedKeys),
    })
    // Intentionally only on (screenName / ownedKeys) — depending on
    // vendorScreenData would reset cleanState on every keystroke,
    // defeating dirty tracking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenName, ownedKeys, screenDefinition])

  // Dirty-tracking: compare the live owned slice against cleanState.
  useEffect(() => {
    if (!screenName) return
    const file = getFile({ name: screenName }).file
    if (!file || file.type !== 'vendor-screen') return
    const current = serializeOwnedSlice(vendorScreenData, ownedKeys)
    const clean = typeof file.cleanState === 'string' ? file.cleanState : current
    const isClean = current === clean
    if (file.saved !== isClean) {
      updateFile({ name: screenName, saved: isClean })
    }
  }, [screenName, ownedKeys, vendorScreenData, getFile, updateFile])

  if (!screenDefinition) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
        Screen not available. Make sure a VPP board is selected.
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto p-4'>
      <VendorScreenRenderer screenDefinition={screenDefinition} moduleSystem={moduleSystem} />
    </div>
  )
}

export { VendorScreenEditor }
