import { useOpenPLCStore } from '@root/renderer/store'

import { CloseIcon, ExitMaximizeIcon, MaximizeIcon, MinimizeIcon } from './icons'

export const MaximizeButton = () => {
  const {
    workspace: { systemConfigs },
  } = useOpenPLCStore()

  return (
    <button
      type='button'
      className='flex h-full items-center justify-center px-[10px] hover:bg-[#021633] hover:dark:bg-neutral-850'
      onClick={() => window.bridge.maximizeWindow()}
    >
      {systemConfigs.appIsMaximized ? <ExitMaximizeIcon /> : <MaximizeIcon />}
    </button>
  )
}

export const MinimizeButton = () => {
  return (
    <button
      type='button'
      className='flex h-full items-center justify-center px-[10px] hover:bg-[#021633] hover:dark:bg-neutral-850'
      onClick={() => window.bridge.minimizeWindow()}
    >
      <MinimizeIcon />
    </button>
  )
}

export const CloseButton = () => {
  return (
    <button
      type='button'
      className='flex h-full items-center justify-center px-[10px] hover:bg-red-600'
      onClick={() => window.bridge.closeWindow()}
    >
      <CloseIcon />
    </button>
  )
}
