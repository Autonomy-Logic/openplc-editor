import { useWindow } from '../../../../middleware/shared/providers'
import { CloseWindowIcon } from '../../../assets/icons/window-controls/Close'
import { ExitMaximizeIcon } from '../../../assets/icons/window-controls/Exit-Maximize'
import { MaximizeIcon } from '../../../assets/icons/window-controls/Maximize'
import { MinimizeIcon } from '../../../assets/icons/window-controls/Minimize'
import { useOpenPLCStore } from '../../../store'
import { WindowControlButton } from '../../_atoms/buttons/window-control'

const MinimizeButton = () => {
  const windowPort = useWindow()
  return (
    <WindowControlButton
      id='minimize-button'
      className='hover:bg-[#021633] hover:dark:bg-neutral-850'
      onClick={() => windowPort.minimize()}
    >
      <MinimizeIcon />
    </WindowControlButton>
  )
}

const MaximizeButton = () => {
  const windowPort = useWindow()
  const {
    workspace: { systemConfigs },
  } = useOpenPLCStore()
  return (
    <WindowControlButton
      id='maximize-button'
      className='hover:bg-[#021633] hover:dark:bg-neutral-850'
      onClick={() => windowPort.maximize()}
    >
      {systemConfigs.isWindowMaximized ? <ExitMaximizeIcon /> : <MaximizeIcon />}
    </WindowControlButton>
  )
}

const CloseButton = () => {
  const windowPort = useWindow()
  const {
    workspace: { editingState },
    modalActions: { openModal },
  } = useOpenPLCStore()
  const handleClose = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (editingState !== 'unsaved') {
      windowPort.close()
    } else {
      openModal('save-changes-project', {
        validationContext: 'close-app',
      })
    }
  }

  return (
    <WindowControlButton id='close-button' className='hover:bg-red-600' onClick={handleClose}>
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
