import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { useQuitApp } from '@root/renderer/hooks/use-quit-app'
import { useOpenPLCStore } from '@root/renderer/store'
import { IProjectServiceResponse } from '@root/types/IPC/project-service'
import { ComponentPropsWithoutRef } from 'react'

import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

export type SaveChangeModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
  validationContext:
    | 'create-project'
    | 'open-project'
    | 'open-recent-project'
    | 'open-project-by-path'
    | 'close-project'
    | 'close-app'
  recentResponse?: IProjectServiceResponse
  projectPath?: string
}

const SaveChangesModal = ({
  isOpen,
  validationContext,
  recentResponse,
  projectPath,
  ...rest
}: SaveChangeModalProps) => {
  const {
    project,
    deviceDefinitions,
    workspaceActions: { setEditingState },
    modalActions: { closeModal, onOpenChange, openModal },
    sharedWorkspaceActions: {
      clearStatesOnCloseProject,
      openProject,
      openRecentProject,
      openProjectByPath,
      saveProject,
    },
  } = useOpenPLCStore()

  const { handleQuitApp, handleCancelQuitApp } = useQuitApp()

  const onClose = () => {
    clearStatesOnCloseProject()
  }

  const handleAcceptCloseModal = async (operation: 'save' | 'not-saving') => {
    closeModal()

    if (operation === 'save') {
      const { success } = await saveProject(project, deviceDefinitions)
      if (!success) {
        return
      }
    }

    switch (validationContext) {
      case 'create-project':
        onClose()
        openModal('create-project', null)
        return
      case 'open-project':
        await openProject()
        return
      case 'open-recent-project': {
        if (!recentResponse) {
          console.error('No recent response provided for opening recent project.')
          return
        }
        openRecentProject(recentResponse)
        return
      }
      case 'open-project-by-path': {
        if (!projectPath) {
          console.error('No project path provided for opening project by path.')
          return
        }
        await openProjectByPath(projectPath)
        return
      }
      case 'close-project':
        setEditingState('initial-state')
        onClose()
        return
      case 'close-app':
        handleQuitApp()
        return
      default:
        break
    }
  }

  const handleCancelModal = () => {
    closeModal()
    if (validationContext === 'close-app') handleCancelQuitApp()
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
