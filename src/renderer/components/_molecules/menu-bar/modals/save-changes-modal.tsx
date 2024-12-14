import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCProjectSchema } from '@root/types/PLC/open-plc'
import _ from 'lodash'

import { Modal, ModalContent } from '../../modal'

interface SaveChangesModalProps {
  isOpen: boolean
  onDiscardChanges: (value: boolean) => void
}

const SaveChangesModal = ({ isOpen, onDiscardChanges }: SaveChangesModalProps) => {
  const {
    project,
    workspaceActions: { setEditingState },
    modalActions: { onOpenChange, openModal },
  } = useOpenPLCStore()

  const handleSaveCloseProject = async () => {
    await handleSaveProject()
    onOpenChange('save-changes-project', false)
    openModal('create-project', null)
  }

  const handleCloseWithoutSaving = () => {
    setEditingState('unsaved')
    onOpenChange('save-changes-project', false)
    openModal('create-project', null)
    onDiscardChanges(true)
  }

  const handleSaveProject = async () => {
    const projectData = PLCProjectSchema.safeParse(project)
    if (!projectData.success) {
      toast({
        title: 'Error in the save request!',
        description: 'The project data is not valid.',
        variant: 'fail',
      })
      return
    }

    const { success, reason } = await window.bridge.saveProject({
      projectPath: project.meta.path,
      //@ts-expect-error overlap
      projectData: project.data,
    })

    if (success) {
      _.debounce(() => setEditingState('saved'), 1000)()
      toast({
        title: 'Changes saved!',
        description: 'The project was saved successfully!',
        variant: 'default',
      })
    } else {
      _.debounce(() => setEditingState('unsaved'), 1000)()
      toast({
        title: 'Error in the save request!',
        description: reason?.description,
        variant: 'fail',
      })
    }
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => onOpenChange('save-changes-project', open)}>
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
                  void handleSaveCloseProject()
                }}
                className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white '
              >
                Save and Close
              </button>
              <button
                onClick={() => {
                  handleCloseWithoutSaving()
                }}
                className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
              >
                Close Without Saving
              </button>
            </div>
            <button
              onClick={() => onOpenChange('save-changes-project', false)}
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
