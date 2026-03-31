import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { useOpenPLCStore } from '@root/renderer/store'

import { Modal, ModalContent } from '../../_molecules/modal'

const RuntimeConnectionLostModal = () => {
  const { modals, modalActions } = useOpenPLCStore()

  const isOpen = modals['runtime-connection-lost']?.open || false
  // Get IP address from modal data (passed when modal was opened, before connection was cleared)
  const modalData = modals['runtime-connection-lost']?.data as { ipAddress?: string } | undefined
  const ipAddress = modalData?.ipAddress ?? 'Unknown'

  // Connection is already cleared when this modal opens, so button just closes the modal
  const handleClose = () => {
    modalActions.closeModal()
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose()
        }
        modalActions.onOpenChange('runtime-connection-lost', open)
      }}
    >
      <ModalContent className='flex max-h-[380px] w-[400px] select-none flex-col items-center justify-evenly rounded-lg'>
        <div className='flex select-none flex-col items-center gap-6'>
          <WarningIcon className='mr-2 mt-2 h-[73px] w-[73px] stroke-amber-500' />
          <div className='px-4'>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              Connection to runtime lost
            </p>
            <p className='mt-2 w-full text-center text-sm text-gray-500 dark:text-neutral-300'>
              The connection to <strong>{ipAddress}</strong> has been lost after multiple failed attempts. Please check
              that the runtime is running and accessible.
            </p>
          </div>
          <div className='flex w-[340px] flex-col gap-2 text-sm'>
            <button
              onClick={handleClose}
              className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white hover:bg-brand-medium-dark'
            >
              OK
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { RuntimeConnectionLostModal }
