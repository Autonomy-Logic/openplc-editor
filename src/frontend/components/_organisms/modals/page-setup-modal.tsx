/**
 * Standalone `File > Page Setup` entry — thin chrome around the same
 * `<PageSetupFields/>` the export wizard's options step uses. Preferences
 * live in the `print` store slice and persist across this modal closing
 * (unlike the wizard's selection, this one is not reset on close).
 */

import { useOpenPLCStore } from '../../../store'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'
import { PageSetupFields } from '../../_molecules/page-setup-fields'

const PageSetupModal = () => {
  const { modals, modalActions } = useOpenPLCStore()

  const isOpen = modals['page-setup']?.open || false
  const close = () => modalActions.onOpenChange('page-setup', false)

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && close()}>
      <ModalContent className='flex h-fit w-[400px] select-none flex-col rounded-lg p-6'>
        <ModalTitle className='mb-4 text-xl font-semibold'>Page Setup</ModalTitle>

        <PageSetupFields />

        <div className='mt-6 flex gap-3'>
          <button
            type='button'
            onClick={close}
            className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
          >
            Done
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { PageSetupModal }
