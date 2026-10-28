import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
import { cleanStateFingerprint, ownedSliceFingerprint, serializeOwnedSlice } from '@root/frontend/utils/vpp/owned-slice'
import {
  collectLinkedConfiguratorKeys,
  collectLinkedScreenKeys,
  linkedScreenNames,
} from '@root/frontend/utils/vpp/persistence-keys'
import { useEffect, useMemo } from 'react'

import { VendorScreenRenderer } from '../device/configuration/vendor-screen'

type VendorScreenEditorProps = {
  screenName: string
}

const VendorScreenEditor = ({ screenName }: VendorScreenEditorProps) => {
  const store = useOpenPLCStoreApi()
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const vendorScreenData = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const addFile = useOpenPLCStore((s) => s.fileActions.addFile)
  const updateFile = useOpenPLCStore((s) => s.fileActions.updateFile)
  const getFile = useOpenPLCStore((s) => s.fileActions.getFile)
  const boardInfo = availableBoards.get(deviceBoard)
  const screens = boardInfo?.vpp?.screens
  const screenDefinition = screens?.[screenName] ?? null
  const moduleSystem = boardInfo?.vpp?.moduleSystem ?? null

  const ownedKeys = useMemo(() => collectLinkedScreenKeys(screens, screenName), [screens, screenName])
  const configuratorKeys = useMemo(() => collectLinkedConfiguratorKeys(screens, screenName), [screens, screenName])

  // Register the file entry for this tab on mount so Ctrl+S, File →
  // Save, and the save-changes-file modal on close find it.
  // cleanState captures the slice this screen owns as it stood when
  // the tab opened — subsequent edits are compared against it for
  // the dirty flag, and "Don't save" restores it via the device
  // slice's bulk setter.  addFile is a no-op when an entry already
  // exists for the same name (re-opening keeps the prior cleanState).
  useEffect(() => {
    if (!screenName || !screenDefinition) return
    // Read the slice from the store, not from this render: the form layouts
    // seed their field defaults in their own mount effects, which run before
    // this one, and those defaults are not an edit. Snapshotting the render's
    // pre-seed value made the screen dirty the moment it opened.
    const { vendorScreenData: seededData } = store.getState().deviceDefinitions.configuration
    // A linked tab already open holds the saved state; the live slice may carry its unsaved edits.
    const linkedClean = linkedScreenNames(screens, screenName)
      .filter((name) => name !== screenName)
      .map((name) => getFile({ name }).file)
      .find((file) => file?.type === 'vendor-screen' && typeof file.cleanState === 'string')?.cleanState
    addFile({
      name: screenName,
      type: 'vendor-screen',
      filePath: '',
      cleanState: typeof linkedClean === 'string' ? linkedClean : serializeOwnedSlice(seededData, ownedKeys),
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
    // From the store for the same reason as the snapshot above: in the commit
    // where a layout seeds its defaults, this render's value predates them.
    const current = ownedSliceFingerprint(
      store.getState().deviceDefinitions.configuration.vendorScreenData,
      ownedKeys,
      configuratorKeys,
    )
    const clean =
      typeof file.cleanState === 'string' ? cleanStateFingerprint(file.cleanState, configuratorKeys) : current
    const isClean = current === clean
    if (file.saved !== isClean) {
      updateFile({ name: screenName, saved: isClean })
    }
  }, [store, screenName, ownedKeys, configuratorKeys, vendorScreenData, getFile, updateFile])

  if (!screenDefinition) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
        Screen not available. Make sure a VPP board is selected.
      </div>
    )
  }

  // The Modbus screen is rendered by the native server editor rather than the
  // generic form layout, so a baremetal board and a Runtime v4 target present
  // the same Modbus UI. The tab, the persistence keys and the dirty/save path
  // are unchanged — only the renderer differs, which is what keeps this from
  // needing a project migration.
  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto p-4'>
      <VendorScreenRenderer screenDefinition={screenDefinition} moduleSystem={moduleSystem} />
    </div>
  )
}

export { VendorScreenEditor }
