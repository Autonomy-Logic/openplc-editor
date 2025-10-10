import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { useOpenPLCStore } from '@root/renderer/store'

import { Modal, ModalContent } from '../../_molecules/modal'

const ConfirmDeviceSwitchModal = () => {
  const { modals, modalActions, deviceActions } = useOpenPLCStore()

  const isOpen = modals['confirm-device-switch']?.open || false
  const modalData = modals['confirm-device-switch']?.data as
    | {
        newBoard: string
        formattedNewBoard: string
        onConfirm: () => void
      }
    | undefined

  const handleConfirmSwitch = () => {
    if (!modalData) return

    deviceActions.setRuntimeJwtToken(null)
    deviceActions.setRuntimeConnectionStatus('disconnected')
    deviceActions.setPlcRuntimeStatus(null)

    if (modalData.onConfirm) {
      modalData.onConfirm()
    }

    modalActions.closeModal()
  }

  const handleCancel = () => {
    modalActions.closeModal()
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => modalActions.onOpenChange('confirm-device-switch', open)}>
      <ModalContent className='flex max-h-80 w-[400px] select-none flex-col items-center justify-evenly rounded-lg'>
        <div className='flex select-none flex-col items-center gap-6'>
          <WarningIcon className='mr-2 mt-2 h-[73px] w-[73px]' />
          <div className='px-4'>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              Switching devices will disconnect you from the runtime.
            </p>
            <p className='mt-2 w-full text-center text-sm text-gray-500 dark:text-neutral-300'>
              Do you want to continue?
            </p>
          </div>
          <div className='flex w-[280px] flex-col gap-1 space-y-2 text-sm'>
            <button
              onClick={handleConfirmSwitch}
              className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white hover:bg-brand-medium-dark'
            >
              Switch Device
            </button>
            <button
              onClick={handleCancel}
              className='w-full rounded-md bg-neutral-100 px-4 py-2 font-medium hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { ConfirmDeviceSwitchModal }
