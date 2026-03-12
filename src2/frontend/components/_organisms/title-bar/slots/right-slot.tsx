import { useCapabilities } from '../../../../../middleware/shared/providers'
import { WindowControls } from '../../../_molecules/window-controls'

const TitleBarRightSlot = () => {
  const caps = useCapabilities()

  return (
    <div id='title-bar-right-slot' className='flex items-center justify-end'>
      {caps.hasNativeWindowControls && <WindowControls />}
    </div>
  )
}

export { TitleBarRightSlot }
