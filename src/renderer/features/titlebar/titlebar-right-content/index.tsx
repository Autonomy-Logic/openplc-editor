import { useOpenPLCStore } from '@process:renderer/store'

import { CloseIcon, MaximizeIcon, MinimizeIcon } from './window-controls-icons'

export const TitlebarRightContent = () => {
  /**
   * Get the platform name from the store and check if it's macOS
   */
  const OS = useOpenPLCStore().workspaceState.systemConfigs.OS
  const isMac = OS === 'darwin'
  /**
   * Create a template for macOS systems
   */
  const DarwinTemplate = () => <></>
  /**
   * Create a template for windows and other systems
   */
  const DefaultTemplate = () => {
    return (
      <div className='flex h-full'>
        <button
          type='button'
          className='flex h-full items-center justify-center px-[10px] hover:bg-[#021633] hover:dark:bg-neutral-850'
          onClick={() => window.bridge.minimizeWindow()}
        >
          <MinimizeIcon />
        </button>
        <button
          type='button'
          className='flex h-full items-center justify-center px-[10px] hover:bg-[#021633] hover:dark:bg-neutral-850'
          onClick={() => window.bridge.maximizeWindow()}
        >
          <MaximizeIcon />
        </button>
        <button
          type='button'
          className='flex h-full items-center justify-center px-[10px] hover:bg-red-600'
          onClick={() => window.bridge.closeWindow()}
        >
          <CloseIcon />
        </button>
      </div>
    )
  }
  /**
   * Render the appropriate template based on the platform
   */
  return <div className='flex items-center justify-end'>{isMac ? <DarwinTemplate /> : <DefaultTemplate />}</div>
}
