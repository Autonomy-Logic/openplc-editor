import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { useCapabilities, useProject } from '../../../../middleware/shared/providers'
import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { executeSaveProject } from '../../../services/save-actions'
import { useOpenPLCStore } from '../../../store'
import type { RungLadderState } from '../../../store/slices/ladder'
import { BasicNodeData } from '../../_atoms/graphical-editor/ladder/utils/types'
import { toast } from '../../_features/[app]/toast/use-toast'
import { Modal, ModalContent } from '../../_molecules/modal'

type ConfirmDeleteElementProps = {
  rung?: RungLadderState | null
  isOpen: boolean
}

const compareVariableTypes = (type1: PLCVariable['type'], type2: PLCVariable['type']): boolean => {
  if (type1.definition !== type2.definition) return false

  if (type1.definition === 'array' && type2.definition === 'array') {
    if (type1.value.toLowerCase() !== type2.value.toLowerCase()) return false
    if (!type1.data || !type2.data) return false
    if (type1.data.dimensions.length !== type2.data.dimensions.length) return false
    return type1.data.dimensions.every((dim1, idx) => dim1.dimension === type2.data!.dimensions[idx].dimension)
  }

  return type1.value.toLowerCase() === type2.value.toLowerCase()
}

/**
 * Resolve the element name and type from modal data.
 * Handles both the new format `{ name, elementType }` and the legacy format `{ leafLang, label }`.
 */
function resolveDeleteTarget(
  data: unknown,
): { name: string; elementType: 'pou' | 'datatype' | 'server' | 'remote-device' } | null {
  if (!data || typeof data !== 'object') return null

  // New format from shared slice deleteRequest actions
  if ('name' in data && 'elementType' in data) {
    const d = data as { name: string; elementType: string }
    if (['pou', 'datatype', 'server', 'remote-device'].includes(d.elementType)) {
      return { name: d.name, elementType: d.elementType as 'pou' | 'datatype' | 'server' | 'remote-device' }
    }
  }

  // Legacy format from web repo: { leafLang, label }
  if ('leafLang' in data && 'label' in data) {
    const d = data as { leafLang: string; label: string }
    const mapping: Record<string, 'pou' | 'datatype' | 'server' | 'remote-device'> = {
      server: 'server',
      remoteDevice: 'remote-device',
      'remote-device': 'remote-device',
      'data-type': 'datatype',
      datatype: 'datatype',
      function: 'pou',
      'function-block': 'pou',
      program: 'pou',
    }
    const elementType = mapping[d.leafLang]
    if (elementType) {
      return { name: d.label, elementType }
    }
  }

  return null
}

const ConfirmDeleteElementModal = ({ rung, isOpen, ...rest }: ConfirmDeleteElementProps) => {
  const store = useOpenPLCStore()
  const projectPort = useProject()
  const capabilities = useCapabilities()
  const {
    editor,
    project: {
      data: { pous },
    },
    projectActions: { deleteVariable },
    ladderFlowActions: { removeRung },
    editorActions: { updateModelVariables },
    modalActions: { onOpenChange, closeModal },
    modals,
  } = store

  const deletePouAction = store.pouActions.delete
  const deleteDatatypeAction = store.datatypeActions.delete
  const deleteServerAction = store.serverActions.delete
  const deleteRemoteDeviceAction = store.remoteDeviceActions.delete

  const modalData = modals['confirm-delete-element']?.data

  const handleDeleteLadderRung = () => {
    if (!rung || !Array.isArray(rung.nodes)) return

    const editorName = editor.meta.name
    const pou = pous.find((p) => p.name === editorName)

    const blockNodes = rung.nodes.filter((node) => node.type === 'block')

    if (blockNodes.length > 0) {
      let variables: PLCVariable[] = []
      if (pou?.interface?.variables) variables = [...pou.interface.variables] as PLCVariable[]

      blockNodes.forEach((blockNode) => {
        const variableData = (blockNode.data as BasicNodeData)?.variable
        if (!variableData) return

        // Try matching by id first (web repo), then by name+type (editor repo)
        let variableIndex = -1
        if ('id' in variableData && variableData.id) {
          variableIndex = variables.findIndex((variable) => variable.id === variableData.id)
        }
        if (variableIndex === -1 && variableData.name) {
          variableIndex = variables.findIndex((variable) => {
            if (variable.name.toLowerCase() !== variableData.name.toLowerCase()) return false
            if ('type' in variableData && variableData.type) {
              return compareVariableTypes(variable.type, variableData.type)
            }
            return true
          })
        }

        if (variableIndex !== -1) {
          deleteVariable({
            rowId: variableIndex,
            scope: 'local',
            associatedPou: editorName,
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

    removeRung(editorName, rung.id)

    toast({
      title: 'Rung deleted success!',
      description: 'Your rung was successfully deleted.',
      variant: 'default',
    })
  }

  const handleDeleteElement = async (): Promise<void> => {
    let needsPersist = false
    try {
      // Ladder rung deletion: takes precedence when a rung is provided.
      // Rung deletes are an in-editor edit, not a file-level deletion — they
      // get persisted along with the next regular save, no auto-save here.
      if (rung && Array.isArray(rung.nodes)) {
        handleDeleteLadderRung()
        closeModal()
        return
      }

      // Element deletion via modal data
      const target = resolveDeleteTarget(modalData)
      if (!target) {
        throw new Error('Invalid modal data for delete confirmation')
      }

      const { name, elementType } = target

      switch (elementType) {
        case 'pou':
          deletePouAction(name)
          toast({
            title: 'POU deleted success!',
            description: `POU "${name}" was successfully deleted.`,
            variant: 'default',
          })
          needsPersist = true
          break
        case 'datatype':
          deleteDatatypeAction(name)
          toast({
            title: 'Datatype deleted success!',
            description: `Datatype "${name}" was successfully deleted.`,
            variant: 'default',
          })
          // Datatypes live inside project.json — they ride along the next
          // regular save (no separate file to remove from S3).
          break
        case 'server':
          deleteServerAction(name)
          toast({
            title: 'Server deleted success!',
            description: `Server "${name}" was successfully deleted.`,
            variant: 'default',
          })
          needsPersist = true
          break
        case 'remote-device':
          deleteRemoteDeviceAction(name)
          toast({
            title: 'Remote device deleted success!',
            description: `Remote device "${name}" was successfully deleted.`,
            variant: 'default',
          })
          needsPersist = true
          break
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

    closeModal()

    // For element types that map to a file in S3 (POU, server, remote device),
    // trigger a full project save so the deletion is actually persisted.
    // Otherwise the file stays in S3 and reappears on refresh — only the
    // local UI state had been updated. executeSaveProject surfaces its own
    // success/failure toasts.
    if (needsPersist) {
      await executeSaveProject(projectPort, capabilities)
    }
  }

  const handleCloseModal = () => {
    closeModal()
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleCloseModal()
        }
        onOpenChange('confirm-delete-element', open)
      }}
      {...rest}
    >
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
              onClick={handleDeleteElement}
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
