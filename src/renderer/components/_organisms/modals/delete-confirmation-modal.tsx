import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/ladder/utils/types'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungLadderState } from '@root/renderer/store/slices'
import { PLCVariable } from '@root/types/PLC'
import { PLCPou } from '@root/types/PLC/open-plc'

import { Modal, ModalContent } from '../../_molecules/modal'

export type DeletePou = {
  type: 'pou'
  file: string
  path: string
  pou: PLCPou
}

export type DeleteDatatype = {
  type: 'datatype'
  file: string
  path: string
}

export type DeleteLadderRung = {
  type: 'ladder-rung'
  file: string
  path: string
  pou: PLCPou
  rung: RungLadderState
}

export type ConfirmDeleteModalProps = {
  isOpen: boolean
  data: DeletePou | DeleteDatatype | DeleteLadderRung
}

const ConfirmDeleteElementModal = ({ isOpen, data, ...rest }: ConfirmDeleteModalProps) => {
  const {
    editor,
    projectActions: { deleteVariable },
    ladderFlowActions: { removeRung },
    editorActions: { updateModelVariables },
    modalActions: { onOpenChange, closeModal },
    pouActions: { delete: deletePouAction },
    datatypeActions: { delete: deleteDatatypeAction },
    sharedWorkspaceActions: { closeFile },
  } = useOpenPLCStore()

  const handleDeleteLadderRung = (data: DeleteLadderRung) => {
    const { pou, rung } = data
    if (Array.isArray(rung.nodes)) {
      /**
       * Remove the variable associated with the block node
       * If the editor is a graphical editor and the variable display is set to table, update the model variables
       * If the variable is the selected row, set the selected row to -1
       *
       * !IMPORTANT: This function must be used inside of components, because the functions deleteVariable and updateModelVariables are just available at the useOpenPLCStore hook
       * -- This block of code references at project:
       *    -- src/renderer/components/_molecules/rung/body.tsx
       *    -- src/renderer/components/_molecules/menu-bar/modals/delete-confirmation-modal.tsx
       *    -- src/renderer/components/_organisms/workspace-activity-bar/ladder-toolbox.tsx
       *    -- src/renderer/components/_molecules/graphical-editor/fbd/index.tsx
       */
      const blockNodes = rung.nodes.filter((node) => node.type === 'block')

      if (blockNodes.length > 0) {
        let variables: PLCVariable[] = []
        if (pou) variables = [...pou.data.variables] as PLCVariable[]

        blockNodes.forEach((blockNode) => {
          const variableData = (blockNode.data as BasicNodeData)?.variable
          const variableIndex = variables.findIndex((variable) => variable.id === variableData?.id)

          if (variableIndex !== -1) {
            deleteVariable({
              variableId: variableData?.id,
              scope: 'local',
              associatedPou: editor.meta.name,
            })
            variables.splice(variableIndex, 1)
          }

          if (
            editor.type === 'plc-graphical' &&
            editor.variable.display === 'table' &&
            parseInt(editor.variable.selectedRow, 10) === variableIndex
          ) {
            updateModelVariables({ display: 'table', selectedRow: -1 })
          }
        })
      }

      removeRung(editor.meta.name, rung.id)

      toast({
        title: 'Rung deleted success!',
        description: 'Your rung was successfully deleted.',
        variant: 'default',
      })
    }
  }

  const handleDeleteDatatype = async (data: DeleteDatatype) => {
    const { file: targetLabel } = data

    const res = await deleteDatatypeAction(data)
    if (!res.success) {
      toast({
        title: res.error?.title || 'Error deleting datatype',
        description: res.error?.description || 'An error occurred while deleting the datatype. Please try again.',
        variant: 'fail',
      })
      return
    }

    closeFile(targetLabel)
    toast({
      title: 'Datatype deleted success!',
      description: `Datatype "${targetLabel}" was successfully deleted.`,
      variant: 'default',
    })
  }

  const handleDeletePou = async (data: DeletePou) => {
    const { file: targetLabel } = data

    const res = await deletePouAction(data)
    if (!res.success) {
      toast({
        title: res.error?.title || 'Error deleting POU',
        description: res.error?.description || 'An error occurred while deleting the POU. Please try again.',
        variant: 'fail',
      })
      return
    }

    closeFile(targetLabel)
    toast({
      title: 'POU deleted success!',
      description: `POU "${targetLabel}" was successfully deleted.`,
      variant: 'default',
    })
  }

  const handleDeleteElement = async (): Promise<void> => {
    try {
      switch (data.type) {
        case 'pou': {
          await handleDeletePou(data)
          break
        }
        case 'datatype': {
          await handleDeleteDatatype(data)
          break
        }
        case 'ladder-rung': {
          handleDeleteLadderRung(data)
          break
        }
        default:
          throw new Error('Unknown element type')
      }
    } catch (_error) {
      toast({
        title: 'Error deleting element',
        description: 'An error occurred while deleting the element. Please try again.',
        variant: 'fail',
      })
    }

    handleCloseModal()
  }

  const handleCloseModal = () => {
    closeModal()
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => onOpenChange('confirm-delete-element', open)} {...rest}>
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
              onClick={() => void handleDeleteElement()}
              className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white'
            >
              Delete
            </button>
            <button
              onClick={handleCloseModal}
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

export { ConfirmDeleteElementModal }
