import { useCapabilities } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { WindowControls } from '../../../_molecules/window-controls'

const TitleBarRightSlot = () => {
  const caps = useCapabilities()
  const OS = useOpenPLCStore((state) => state.workspace.systemConfigs.OS)

  return (
    <div id='title-bar-right-slot' className='flex items-center justify-end'>
      {caps.isNativeApplication && OS === 'win32' && <WindowControls />}
    </div>
  )
}

export { TitleBarRightSlot }
