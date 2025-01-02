import { CloseWindowIcon, ExitMaximizeIcon, MaximizeIcon, MinimizeIcon } from '@root/renderer/assets/icons'
import { WindowControlButton } from '@root/renderer/components/_atoms/buttons/window-control'
import { useOpenPLCStore } from '@root/renderer/store'

const MinimizeButton = () => {
  return (
    <WindowControlButton
      id='minimize-button'
      className='hover:bg-[#021633] hover:dark:bg-neutral-850'
      onClick={() => window.bridge.minimizeWindow()}
    >
      <MinimizeIcon />
    </WindowControlButton>
  )
}

const MaximizeButton = () => {
  const {
    workspace: { systemConfigs },
  } = useOpenPLCStore()
  return (
    <WindowControlButton
      id='maximize-button'
      className='hover:bg-[#021633] hover:dark:bg-neutral-850'
      onClick={() => window.bridge.maximizeWindow()}
    >
      {systemConfigs.isWindowMaximized ? <ExitMaximizeIcon /> : <MaximizeIcon />}
    </WindowControlButton>
  )
}

const CloseButton = () => {
  const {
    workspace: {
      systemConfigs: { OS },
    },
  } = useOpenPLCStore()

  const handleClose = () => {
    OS === 'darwin' ? window.bridge.hideWindow() : window.bridge.closeWindow()
  }
  return (
    <WindowControlButton id='close-button' className='hover:bg-red-600' onClick={() => handleClose()}>
      <CloseWindowIcon />
    </WindowControlButton>
  )
}

const WindowControls = () => {
  return (
    <div id='window-controls' className='flex h-full'>
      <MinimizeButton />
      <MaximizeButton />
      <CloseButton />
    </div>
  )
}

export { WindowControls }
