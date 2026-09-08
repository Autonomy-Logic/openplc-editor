import { ComponentPropsWithoutRef } from 'react'

import { useCapabilities, useNavigation, useProject, useWindow } from '../../../../middleware/shared/providers'
import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { executeSaveProject } from '../../../services/save-actions'
import { useOpenPLCStore } from '../../../store'
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
 * - 'retrieve-project': Close current, then open the project fetched from a
 *   device (both platforms)
 */
export type ValidationContext =
  | 'create-project'
  | 'open-project'
  | 'open-recent-project'
  | 'open-project-by-path'
  | 'close-project'
  | 'close-app'
  | 'retrieve-project'

export type SaveChangeModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
  validationContext: ValidationContext
  /** Callback to execute after save+close completes (e.g., re-open recent project). */
  onAfterAction?: () => void
  /**
   * Called instead of `onAfterAction` when the user chose Save and the save
   * failed, so the caller can say that what it was waiting to do is not
   * happening.
   *
   * A refused save is not always a broken one: a project retrieved from a
   * device has no location the user chose, so saving it refuses BY DESIGN and
   * points at Save As. Retrieving on top of it therefore took the one path that
   * silently dropped the fetched project -- the dialog had already closed and
   * the picker had already stepped aside, and the only thing on screen was a
   * toast about the save.
   *
   * Cancel reports too. Answering a dialog you did not ask for with Cancel does
   * not tell you what it abandoned: the user had pressed Continue on a retrieve,
   * watched it fetch, and then both dialogs vanished with nothing said.
   */
  onActionAborted?: (reason: 'save-failed' | 'cancelled') => void
}

const SaveChangesModal = ({
  isOpen,
  validationContext,
  onAfterAction,
  onActionAborted,
  ...rest
}: SaveChangeModalProps) => {
  const {
    workspaceActions: { setEditingState },
    modalActions: { closeModal, onOpenChange, openModal },
  } = useOpenPLCStore()

  const projectPort = useProject()
  const windowPort = useWindow()
  const navigation = useNavigation()
  const capabilities = useCapabilities()

  const {
    sharedWorkspaceActions: { clearStatesOnCloseProject, handleOpenProjectResponse },
  } = useOpenPLCStore()

  const clearAndClose = () => {
    clearStatesOnCloseProject()
    setEditingState('initial-state')
  }

  const handleAcceptCloseModal = async (operation: 'save' | 'not-saving') => {
    closeModal()

    if (operation === 'save') {
      const result = await executeSaveProject(projectPort, capabilities)
      if (!result.success) {
        // The save already said why. This says what it cost: whatever was
        // waiting on it is not going to happen, and the caller is the only one
        // who can name it.
        onActionAborted?.('save-failed')
        return
      }
    }

    switch (validationContext) {
      case 'create-project':
        clearAndClose()
        openModal('create-project', null)
        return
      case 'open-project': {
        const result = await projectPort.openProject()
        if (result.success && result.data) {
          handleOpenProjectResponse(result.data)
        }
        return
      }
      // 'retrieve-project' belongs with these rather than with 'close-project':
      // the deferred action opens something, so closing is a step on the way and
      // not the outcome. Under 'close-project' both buttons ended at the start
      // screen with the fetched project abandoned -- the retrieve was never
      // resumed. (The comment sits above the labels rather than between them:
      // `no-fallthrough` counts a case body of only comments as non-empty.)
      case 'open-recent-project':
      case 'open-project-by-path':
      case 'retrieve-project':
        // Execute the deferred action (e.g., re-open the recent project)
        onAfterAction?.()
        return
      case 'close-project':
        clearAndClose()
        navigation.exitToHost()
        return
      case 'close-app':
        if (capabilities.isNativeApplication) {
          windowPort.quit()
        }
        return
      default: {
        // A context added without a branch here would otherwise close the
        // dialog and do nothing, which is indistinguishable from Cancel.
        const exhaustive: never = validationContext
        return exhaustive
      }
    }
  }

  const handleCancelModal = () => {
    closeModal()
    onActionAborted?.('cancelled')
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
