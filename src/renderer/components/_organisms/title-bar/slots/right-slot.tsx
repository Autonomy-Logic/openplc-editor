import { useOpenPLCStore } from '@process:renderer/store'

import { WindowControls } from '../../../_molecules/window-controls'

const TitleBarRightSlot = () => {
  // Use granular selector to prevent re-renders from unrelated store updates (e.g., polling)
  const OS = useOpenPLCStore((state) => state.workspace.systemConfigs.OS)

  const isMac = OS === 'darwin'

  return (
    <div id='title-bar-right-slot' className='flex items-center justify-end'>
      {!isMac && <WindowControls />}
    </div>
  )
}

export { TitleBarRightSlot }
