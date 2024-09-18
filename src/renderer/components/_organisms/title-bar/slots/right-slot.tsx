import { useOpenPLCStore } from '@process:renderer/store'

import { WindowControls } from '../../../_molecules/window-controls'

const TitleBarRightSlot = () => {
  /**
   * Get the platform name from the store and check if it's macOS
   */
  const {
    workspace: {
      systemConfigs: { OS },
    },
  } = useOpenPLCStore()
  const isMac = OS === 'darwin'
  /**
   * Create a template for macOS systems
   */
  const DarwinTemplate = () => <></>
  /**
   * Create a template for windows and other systems
   */
  const DefaultTemplate = () => <WindowControls />

  /**
   * Render the appropriate template based on the platform
   */
  return (
    <div id='title-bar-right-slot' className='flex items-center justify-end'>
      {isMac ? <DarwinTemplate /> : <DefaultTemplate />}
    </div>
  )
}

export { TitleBarRightSlot }
