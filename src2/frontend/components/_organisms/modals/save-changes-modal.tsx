import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { useOpenPLCStore } from '../../../store'
import { useProject, useWindow, useCapabilities } from '../../../../middleware/shared/providers'
import { ComponentPropsWithoutRef } from 'react'

import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

/**
 * Validation contexts for save-before-close flows.
 *
 * - 'close-project': Close the current project (both platforms)
 * - 'create-project': Close current, then open create-project dialog (editor)
 * - 'open-project': Close current, then open file picker (editor)
 * - 'open-recent-project': Close current, then open a recent project (editor)
 * - 'open-project-by-path': Close current, then open project at path (editor)
 * - 'close-app': Save before quitting the application (editor)
 */
export type ValidationContext =
  | 'create-project'
  | 'open-project'
  | 'open-recent-project'
  | 'open-project-by-path'
  | 'close-project'
  | 'close-app'

export type SaveChangeModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
  validationContext: ValidationContext
}

const SaveChangesModal = ({ isOpen, validationContext, ...rest }: SaveChangeModalProps) => {
  const {
    project,
    deviceDefinitions,
    workspaceActions: { setEditingState },
    modalActions: { closeModal, onOpenChange, openModal },
  } = useOpenPLCStore()

  const projectPort = useProject()
  const windowPort = useWindow()
  const capabilities = useCapabilities()

  const clearAndClose = () => {
    // Web navigates back; editor resets editing state
    setEditingState('initial-state')
    if (!capabilities.hasLocalFilesystem) {
      window.history.back()
    }
  }

  const handleAcceptCloseModal = async (operation: 'save' | 'not-saving') => {
    closeModal()

    if (operation === 'save') {
      const result = await projectPort.saveProject({
        projectPath: project.meta.path,
        projectData: project.data,
        deviceConfiguration: deviceDefinitions.configuration,
        devicePinMapping: deviceDefinitions.pinMapping.pins,
      })
      if (!result.success) {
        return
      }
    }

    switch (validationContext) {
      case 'create-project':
        clearAndClose()
        openModal('create-project', null)
        return
      case 'open-project':
        await projectPort.openProject()
        return
      case 'open-recent-project':
        // Editor-specific: handled via IPC callback outside the modal
        return
      case 'open-project-by-path':
        // Editor-specific: handled via IPC callback outside the modal
        return
      case 'close-project':
        clearAndClose()
        return
      case 'close-app':
        if (capabilities.hasNativeWindowControls) {
          windowPort.quit()
        }
        return
      default:
        break
    }
  }

  const handleCancelModal = () => {
    closeModal()
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleCancelModal()
        }
        onOpenChange('save-changes-project', open)
      }}
      {...rest}
    >
      <ModalContent className='flex h-[420px] w-[340px] select-none flex-col items-center justify-evenly rounded-lg'>
        <ModalTitle className='hidden'>Save project changes</ModalTitle>
        <div className='flex h-[350px] select-none flex-col items-center gap-6'>
          <WarningIcon className='mr-2 mt-2 h-[73px] w-[73px]' />
          <div>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              There are unsaved changes in your <strong>project</strong>. Do you want to save before closing?
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
export { SaveChangesModal }
