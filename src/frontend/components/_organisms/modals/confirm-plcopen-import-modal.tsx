/**
 * Confirmation modal for File → "Import PLCopen XML".
 *
 * Distinct from `confirm-delete-project` in that it carries no data
 * payload — it acts on whatever project is currently open (an in-place
 * content overwrite), not a specific record picked from a list.
 */

import { useProject } from '../../../../middleware/shared/providers'
import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { executeImportPlcopen } from '../../../services/import-actions'
import { useOpenPLCStore } from '../../../store'
import { Modal, ModalContent } from '../../_molecules/modal'

type ConfirmPlcopenImportModalProps = {
  isOpen: boolean
}

const ConfirmPlcopenImportModal = ({ isOpen, ...rest }: ConfirmPlcopenImportModalProps) => {
  const projectPort = useProject()
  const {
    modalActions: { onOpenChange, closeModal },
  } = useOpenPLCStore()

  const handleConfirm = async () => {
    await executeImportPlcopen(projectPort)
    closeModal()
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeModal()
        onOpenChange('confirm-plcopen-import', open)
      }}
      {...rest}
    >
      <ModalContent className='flex max-h-96 w-[340px] select-none flex-col items-center justify-evenly rounded-lg'>
        <div className='flex select-none flex-col items-center gap-5'>
          <WarningIcon className='mt-2 h-[73px] w-[73px]' />
          <div className='flex flex-col gap-2'>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              Import PLCopen XML?
            </p>
            <p className='w-full text-center text-xs text-gray-500 dark:text-neutral-400'>
              Importing a PLCopen XML file will overwrite the entire currently open project. This cannot be undone.
            </p>
          </div>
          <div className='flex w-[220px] flex-col gap-1 space-y-2 text-sm'>
            <button
              onClick={() => void handleConfirm()}
              className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white'
            >
              Import PLCopen XML
            </button>
            <button
              onClick={() => closeModal()}
              className='w-full rounded-md bg-neutral-100 px-4 py-2 font-medium dark:bg-neutral-850 dark:text-neutral-100'
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { ConfirmPlcopenImportModal }
