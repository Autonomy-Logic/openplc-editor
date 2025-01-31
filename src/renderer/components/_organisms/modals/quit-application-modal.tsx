import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { useQuitApp } from '@root/renderer/hooks/use-quit-app'
import { useOpenPLCStore } from '@root/renderer/store'
import _ from 'lodash'
import { ComponentPropsWithoutRef } from 'react'

import { Modal, ModalContent } from '../../_molecules/modal'

type SaveChangeModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
}

const QuitApplicationModal = ({ isOpen, ...rest }: SaveChangeModalProps) => {
  const {
    modalActions: { closeModal, onOpenChange },
  } = useOpenPLCStore()

  const { handleQuitApp, handleCancelAppIsClosing } = useQuitApp()

  const handleCloseApplication = () => {
    handleQuitApp()
  }

  const handleCancelModal = () => {
    closeModal()
    handleCancelAppIsClosing()
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => onOpenChange('quit-application', open)} {...rest}>
      <ModalContent className='flex max-h-80 w-[300px] select-none flex-col items-center justify-evenly rounded-lg'>
        <div className='flex select-none flex-col items-center gap-6'>
          <WarningIcon className='mr-2 mt-2 h-[73px] w-[73px]' />
          <div>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              Are you sure you want to quit the application?
            </p>
          </div>
          <div className='flex w-[200px] flex-col gap-1 space-y-2 text-sm'>
            <button
              onClick={handleCloseApplication}
              className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white'
            >
              Yes
            </button>
            <button
              onClick={() => handleCancelModal()}
              className='w-full rounded-md bg-neutral-100 px-4 py-2 font-medium dark:bg-neutral-850 dark:text-neutral-100'
            >
              No
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
export { QuitApplicationModal }
