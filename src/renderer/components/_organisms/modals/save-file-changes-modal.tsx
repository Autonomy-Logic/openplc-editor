import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { useOpenPLCStore } from '@root/renderer/store'
import { ComponentPropsWithoutRef } from 'react'

import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

export type SaveFileChangeModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
  fileName: string
  validationContext: 'close-file'
}

const SaveFileChangesModal = ({ isOpen, validationContext, fileName, ...rest }: SaveFileChangeModalProps) => {
  const {
    modalActions: { closeModal, onOpenChange },
    sharedWorkspaceActions: { saveFile, closeFile },
  } = useOpenPLCStore()

  /**
   * TODO: Add rollback to file changes if the save operation is not-saving and the file is only closed.
   */
  const handleAcceptCloseModal = async (operation: 'save' | 'not-saving') => {
    closeModal()

    if (operation === 'save') {
      await saveFile(fileName)
    }

    closeFile(fileName)
  }

  const handleCancelModal = () => {
    closeModal()
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => onOpenChange('save-changes-project', open)} {...rest}>
      <ModalContent className='flex h-[420px] w-[340px] select-none flex-col items-center justify-evenly rounded-lg'>
        <ModalTitle className='hidden'>Save file changes</ModalTitle>
        <div className='flex h-[350px] select-none flex-col items-center gap-6'>
          <WarningIcon className='mr-2 mt-2 h-[73px] w-[73px]' />
          <div>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              There are unsaved changes in your <strong>file</strong>. Do you want to save before closing?
            </p>
          </div>

          <div className='flex w-[300px] flex-col text-sm'>
            <div className='mb-6 flex flex-col gap-2'>
              <button
                onClick={() => {
                  void handleAcceptCloseModal('save')
                }}
                className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white '
              >
                Save and close
              </button>
              <button
                onClick={() => {
                  void handleAcceptCloseModal('not-saving')
                }}
                className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
              >
                Close without saving
              </button>
            </div>
            <button
              onClick={() => handleCancelModal()}
              className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
export { SaveFileChangesModal }
