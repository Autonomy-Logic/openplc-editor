import { useOpenPLCStore } from '@root/frontend/store'

import { VendorScreenRenderer } from '../device/configuration/vendor-screen'

const VendorScreenEditor = () => {
  const editor = useOpenPLCStore((s) => s.editor)
  const screenName = editor.type === 'plc-vendor-screen' ? editor.meta.screenName : ''
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const boardInfo = availableBoards.get(deviceBoard)
  const screenDefinition = boardInfo?.vpp?.screens?.[screenName] ?? null
  const moduleSystem = boardInfo?.vpp?.moduleSystem ?? null

  if (!screenDefinition) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
        Screen not available. Make sure a VPP board is selected.
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 overflow-y-auto p-4'>
      <VendorScreenRenderer screenDefinition={screenDefinition} moduleSystem={moduleSystem} />
    </div>
  )
}

export { VendorScreenEditor }
