import { titleBarSelectors } from '@root/renderer/hooks/use-store-selectors'

import { WindowControls } from '../../../_molecules/window-controls'

const TitleBarRightSlot = () => {
  const OS = titleBarSelectors.useOS()

  const isMac = OS === 'darwin'

  return (
    <div id='title-bar-right-slot' className='flex items-center justify-end'>
      {!isMac && <WindowControls />}
    </div>
  )
}

export { TitleBarRightSlot }
