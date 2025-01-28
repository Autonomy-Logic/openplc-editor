import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useQuitApp } from '@root/renderer/hooks/use-quit-app'
import { useOpenPLCStore } from '@root/renderer/store'
import { FlowType } from '@root/renderer/store/slices/flow'
import { PLCProjectSchema } from '@root/types/PLC/open-plc'
import _ from 'lodash'
import { ComponentPropsWithoutRef } from 'react'

import { Modal, ModalContent } from '../../modal'

type SaveChangeModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
  validationContext: string
}

const SaveChangesModal = ({ isOpen, validationContext, ...rest }: SaveChangeModalProps) => {
  const {
    project,
    workspaceActions: { setEditingState },
    modalActions: { closeModal, onOpenChange, openModal },
    tabsActions: { clearTabs },
    projectActions: { setProject, clearProjects },
    flowActions: { addFlow, clearFlows },
    libraryActions: { addLibrary, clearUserLibraries },
    editorActions: { clearEditor },
  } = useOpenPLCStore()

  const { handleQuitApp, handleCancelWindowClose } = useQuitApp()

  const onClose = () => {
    clearEditor()
    clearTabs()
    clearUserLibraries()
    clearFlows()
    clearProjects()
  }

  const handleAcceptCloseModal = async (operation: 'save' | 'not-saving') => {
    closeModal()

    if (operation === 'save') {
      const { success } = await handleSaveProject()
      if (!success) {
        return
      }
    }

    if (validationContext === 'create-project') {
      onClose()
      openModal('create-project', null)
      return
    }

    // Validate
    if (validationContext === 'open-project') {
      try {
        const { success, data, error } = await window.bridge.openProject()
        if (success && data) {
          onClose()
          setEditingState('unsaved')

          const projectMeta = {
            name: data.content.meta.name,
            type: data.content.meta.type,
            path: data.meta.path,
          }

          const projectData = data.content.data

          setProject({
            meta: projectMeta,
            data: projectData,
          })

          const ladderPous = projectData.pous.filter(
            (pou: { data: { language: string } }) => pou.data.language === 'ld',
          )

          if (ladderPous.length) {
            ladderPous.forEach((pou) => {
              if (pou.data.body.language === 'ld') {
                addFlow(pou.data.body.value as FlowType)
              }
            })
          }
          data.content.data.pous.forEach((pou) => {
            if (pou.type !== 'program') {
              addLibrary(pou.data.name, pou.type)
            }
          })
          toast({
            title: 'Project opened!',
            description: 'Your project was opened and loaded successfully.',
            variant: 'default',
          })
        } else {
          toast({
            title: 'Cannot open the project.',
            description: error?.description || 'Failed to open the project.',
            variant: 'fail',
          })
        }
      } catch (_error) {
        toast({
          title: 'An error occurred.',
          description: 'There was a problem opening the project.',
          variant: 'fail',
        })
      }

      return
    }

    if (validationContext === 'close-app') {
      handleQuitApp()
      return
    }

    if (validationContext === 'close-project') {
      setEditingState('initial-state')
      onClose()
      return
    }
  }

  const handleSaveProject = async () => {
    const projectData = PLCProjectSchema.safeParse(project)
    if (!projectData.success) {
      toast({
        title: 'Error in the save request!',
        description: 'The project data is not valid.',
        variant: 'fail',
      })
      return { success: projectData.success }
    }

    const { success, reason } = await window.bridge.saveProject({
      projectPath: project.meta.path,
      projectData: projectData.data,
    })

    if (success) {
      setEditingState('saved')
      toast({
        title: 'Changes saved!',
        description: 'The project was saved successfully!',
        variant: 'default',
      })
    } else {
      toast({
        title: 'Error in the save request!',
        description: reason?.description,
        variant: 'fail',
      })
    }
    return { success, reason }
  }

  const handleCancelModal = () => {
    closeModal()
    handleCancelWindowClose()
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => onOpenChange('save-changes-project', open)} {...rest}>
      <ModalContent className='flex h-[420px] w-[340px] select-none flex-col items-center justify-evenly rounded-lg'>
        <div className='flex h-[350px] select-none flex-col items-center gap-6'>
          <WarningIcon className='mr-2 mt-2 h-[73px] w-[73px]' />
          <div>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              There are unsaved changes in your project. Do you want to save before closing?
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
