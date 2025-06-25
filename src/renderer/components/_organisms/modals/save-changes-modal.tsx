import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useQuitApp } from '@root/renderer/hooks/use-quit-app'
import { useOpenPLCStore } from '@root/renderer/store'
import { FBDFlowType, LadderFlowType } from '@root/renderer/store/slices'
import _ from 'lodash'
import { ComponentPropsWithoutRef } from 'react'

import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'
import { saveProjectRequest } from '../../_templates'

type SaveChangeModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
  validationContext: string
}

const SaveChangesModal = ({ isOpen, validationContext, ...rest }: SaveChangeModalProps) => {
  const {
    project,
    deviceDefinitions,
    workspaceActions: { setEditingState },
    modalActions: { closeModal, onOpenChange, openModal },
    tabsActions: { clearTabs },
    projectActions: { setProject, clearProjects },
    fbdFlowActions: { addFBDFlow, clearFBDFlows },
    ladderFlowActions: { addLadderFlow, clearLadderFlows },
    libraryActions: { addLibrary, clearUserLibraries },
    editorActions: { clearEditor },
    deviceActions: { clearDeviceDefinitions, setDeviceDefinitions },
  } = useOpenPLCStore()

  const { handleQuitApp, handleCancelQuitApp } = useQuitApp()

  const onClose = () => {
    clearEditor()
    clearTabs()
    clearUserLibraries()
    clearFBDFlows()
    clearLadderFlows()
    clearProjects()
    clearDeviceDefinitions()
  }

  const handleAcceptCloseModal = async (operation: 'save' | 'not-saving') => {
    closeModal()

    if (operation === 'save') {
      const { success } = await saveProjectRequest(project, deviceDefinitions, setEditingState)
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

          const { project, deviceConfiguration, devicePinMapping } = data.content

          const projectMeta = {
            name: project.meta.name,
            type: project.meta.type,
            path: data.meta.path,
          }

          const projectData = project.data

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
                addLadderFlow(pou.data.body.value as LadderFlowType)
              }
            })
          }

          const fdbPous = projectData.pous.filter((pou: { data: { language: string } }) => pou.data.language === 'fbd')
          if (fdbPous.length) {
            fdbPous.forEach((pou) => {
              if (pou.data.body.language === 'fbd') {
                addFBDFlow(pou.data.body.value as FBDFlowType)
              }
            })
          }

          projectData.pous.forEach((pou) => {
            if (pou.type !== 'program') {
              addLibrary(pou.data.name, pou.type)
            }
          })

          setDeviceDefinitions({
            configuration: deviceConfiguration,
            pinMapping: devicePinMapping,
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

  const handleCancelModal = () => {
    closeModal()
    if (validationContext === 'close-app') handleCancelQuitApp()
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => onOpenChange('save-changes-project', open)} {...rest}>
      <ModalContent className='flex h-[420px] w-[340px] select-none flex-col items-center justify-evenly rounded-lg'>
        <ModalTitle className='hidden'>Save changes</ModalTitle>
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
