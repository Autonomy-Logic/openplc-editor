import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { useHandleRemoveTab } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect } from 'react'

import { Modal, ModalContent } from '../../modal'

const ConfirmDeletePousModal = ({ isOpen }: { isOpen: boolean }) => {
  const {
    editor,
    projectActions: { deletePou },
    flowActions: { removeFlow },
    libraryActions: { removeUserLibrary },
    modalActions: { onOpenChange },
  } = useOpenPLCStore()
  const { handleRemoveTab, selectedTab, setSelectedTab } = useHandleRemoveTab()

  useEffect(() => {
    setSelectedTab(editor.meta.name)
  }, [editor])
  const handleDeletePou = () => {
    handleRemoveTab(selectedTab)
    deletePou(selectedTab)
    removeFlow(selectedTab)
    removeUserLibrary(selectedTab)
    onOpenChange('confirm-delete-POUs', false)
  }

  const handleCloseModal = () => {
    onOpenChange('confirm-delete-POUs', false)
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => onOpenChange('confirm-delete-POUs', open)}>
      <ModalContent className='flex max-h-80 w-[300px] select-none flex-col items-center justify-evenly rounded-lg'>
        <div className='flex select-none flex-col items-center gap-6'>
          <WarningIcon className='mr-2 mt-2 h-[73px] w-[73px]' />
          <div>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              Are you sure you want to delete this item?
            </p>
          </div>
          <div className='flex w-[200px] flex-col gap-1 space-y-2 text-sm'>
            <button
              onClick={() => {
                handleDeletePou()
              }}
              className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white'
            >
              Delete
            </button>
            <button
              onClick={handleCloseModal}
              className='w-full rounded-md bg-neutral-100 px-4 py-2 font-medium dark:bg-neutral-850 dark:text-neutral-100 '
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
export { ConfirmDeletePousModal }
