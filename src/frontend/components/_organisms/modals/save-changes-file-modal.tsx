import { ComponentPropsWithoutRef } from 'react'

import { useCapabilities, useProject } from '../../../../middleware/shared/providers'
import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { executeSaveFile, reloadFileFromDisk } from '../../../services/save-actions'
import { useOpenPLCStore } from '../../../store'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

export type SaveChangesFileModalData = {
  fileName: string
}

export type SaveChangesFileModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
  data: SaveChangesFileModalData
}

const SaveChangesFileModal = ({ isOpen, data, ...rest }: SaveChangesFileModalProps) => {
  const {
    modalActions: { closeModal, onOpenChange },
    sharedWorkspaceActions: { forceCloseFile },
    fileActions: { updateFile },
  } = useOpenPLCStore()

  const projectPort = useProject()
  const capabilities = useCapabilities()
  const { fileName } = data

  const handleSave = async () => {
    closeModal()

    const result = await executeSaveFile(fileName, projectPort, capabilities)
    if (!result.success) return

    forceCloseFile(fileName)
  }

  const handleDontSave = async () => {
    closeModal()

    await reloadFileFromDisk(fileName, projectPort)
    updateFile({ name: fileName, saved: true })
    forceCloseFile(fileName)
  }

  const handleCancel = () => {
    closeModal()
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel()
        }
        onOpenChange('save-changes-file', open)
      }}
      {...rest}
    >
      <ModalContent className='flex h-[420px] w-[340px] select-none flex-col items-center justify-evenly rounded-lg'>
        <ModalTitle className='hidden'>Save file changes</ModalTitle>
        <div className='flex h-[350px] select-none flex-col items-center gap-6'>
          <WarningIcon className='mr-2 mt-2 h-[73px] w-[73px]' />
          <div>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              <strong>{fileName}</strong> has unsaved changes. Do you want to save before closing?
            </p>
          </div>

          <div className='flex w-[300px] flex-col text-sm'>
            <div className='mb-6 flex flex-col gap-2'>
              <button
                onClick={() => void handleSave()}
                className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white'
              >
                Save
              </button>
              <button
                onClick={() => void handleDontSave()}
                className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
              >
                Don't Save
              </button>
            </div>
            <button
              onClick={handleCancel}
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

export { SaveChangesFileModal }
