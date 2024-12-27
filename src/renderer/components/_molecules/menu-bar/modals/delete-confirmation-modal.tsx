import { WarningIcon } from '@root/renderer/assets/icons/interface/Warning'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useHandleRemoveTab } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungState } from '@root/renderer/store/slices'
import { PLCVariable } from '@root/types/PLC'
import { useEffect } from 'react'

import { Modal, ModalContent } from '../../modal'

type ConfirmDeleteElementProps = {
  rung?: RungState
  isOpen: boolean
  validationContext: string | null
}

const ConfirmDeleteElementModal = ({ rung, isOpen, validationContext, ...rest }: ConfirmDeleteElementProps) => {
  const {
    editor,
    projectActions: { deletePou, deleteDatatype },
    flowActions: { removeFlow, removeRung },
    project: {
      data: { pous },
    },
    editorActions: { updateModelVariables },
    libraryActions: { removeUserLibrary },
    modalActions: { onOpenChange },
    projectActions: { deleteVariable },
  } = useOpenPLCStore()
  const { handleRemoveTab, selectedTab, setSelectedTab } = useHandleRemoveTab()
  const editorName = editor.meta.name
  const pou = pous.find((pou) => pou.data.name === editorName)

  useEffect(() => {
    setSelectedTab(editor.meta.name)
  }, [editor])
  const handleDeleteElement = () => {
    try {
      if (rung) {
        const blockNodes = rung.nodes.filter((node) => node.type === 'block')

        if (blockNodes.length > 0) {
          let variables: PLCVariable[] = []
          if (pou) variables = [...pou.data.variables] as PLCVariable[]

          blockNodes.forEach((blockNode) => {
            const variableIndex = variables.findIndex(
              (variable) => variable.id === (blockNode.data as BasicNodeData).variable.id,
            )
            if (variableIndex !== -1) {
              deleteVariable({
                rowId: variableIndex,
                scope: 'local',
                associatedPou: editor.meta.name,
              })
              variables.splice(variableIndex, 1)
            }

            if (
              editor.type === 'plc-graphical' &&
              editor.variable.display === 'table' &&
              parseInt(editor.variable.selectedRow) === variableIndex
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
        onOpenChange('confirm-delete-element', false)
        return
      }

      if (editor.type === 'plc-datatype') {
        handleRemoveTab(selectedTab)
        deleteDatatype(selectedTab)
        removeFlow(selectedTab)
        removeUserLibrary(selectedTab)
        toast({
          title: 'Datatype deleted success!',
          description: 'Your datatype was successfully deleted.',
          variant: 'default',
        })
        onOpenChange('confirm-delete-element', false)
        return
      }

      if (editor.type === 'plc-textual' || editor.type === 'plc-graphical') {
        handleRemoveTab(selectedTab)
        deletePou(selectedTab)
        removeFlow(selectedTab)
        removeUserLibrary(selectedTab)
        toast({
          title: 'Pou deleted success!',
          description: 'Your pou was successfully deleted.',
          variant: 'default',
        })
        onOpenChange('confirm-delete-element', false)
        return
      }
    } catch (error) {
      toast({
        title: 'Error deleting element',
        description: 'An error occurred while deleting the element. Please try again.',
        variant: 'fail',
      })
      console.error('Error deleting element:', error)
    }

    onOpenChange('confirm-delete-element', false)
  }

  const handleCloseModal = () => {
    onOpenChange('confirm-delete-element', false)
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
              onClick={() => {
                handleDeleteElement()
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
export { ConfirmDeleteElementModal }
