import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { WarningIcon } from '../../../assets/icons/interface/Warning'
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

type DeleteElementType = 'pou' | 'datatype' | 'global-variable-list' | 'server' | 'remote-device'

const DELETE_ELEMENT_TYPES: readonly DeleteElementType[] = [
  'pou',
  'datatype',
  'global-variable-list',
  'server',
  'remote-device',
]

/** Legacy `leafLang` values, mapped onto the element types the modal deletes. */
const LEGACY_LEAF_LANG: Record<string, DeleteElementType> = {
  gvl: 'global-variable-list',
  'global-variable-list': 'global-variable-list',
  server: 'server',
  remoteDevice: 'remote-device',
  'remote-device': 'remote-device',
  'data-type': 'datatype',
  datatype: 'datatype',
  function: 'pou',
  'function-block': 'pou',
  program: 'pou',
}

/** Read a string property off an unknown payload, or `undefined` when it isn't one. */
function stringField(data: object, key: string): string | undefined {
  const value = (data as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

const isDeleteElementType = (value: string): value is DeleteElementType =>
  DELETE_ELEMENT_TYPES.some((candidate) => candidate === value)

/**
 * Resolve the element name and type from modal data.
 * Handles both the new format `{ name, elementType }` and the legacy format `{ leafLang, label }`.
 *
 * Narrowed rather than asserted: `'name' in data` proves the key is there, not that it
 * holds a string, so an assertion here could hand a non-string straight to a delete
 * action. Every field is checked before it is used.
 */
function resolveDeleteTarget(data: unknown): { name: string; elementType: DeleteElementType } | null {
  if (!data || typeof data !== 'object') return null

  // New format from shared slice deleteRequest actions
  const name = stringField(data, 'name')
  const elementType = stringField(data, 'elementType')
  if (name !== undefined && elementType !== undefined && isDeleteElementType(elementType)) {
    return { name, elementType }
  }

  // Legacy format from web repo: { leafLang, label }
  const leafLang = stringField(data, 'leafLang')
  const label = stringField(data, 'label')
  if (leafLang !== undefined && label !== undefined) {
    const mapped = LEGACY_LEAF_LANG[leafLang]
    if (mapped) return { name: label, elementType: mapped }
  }

  return null
}

const ConfirmDeleteElementModal = ({ rung, isOpen, ...rest }: ConfirmDeleteElementProps) => {
  const store = useOpenPLCStore()
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
  const deleteGlobalVariableListAction = store.globalVariableListActions.delete

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

  const handleDeleteElement = (): void => {
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
        case 'global-variable-list':
          deleteGlobalVariableListAction(name)
          toast({
            title: 'Global variable list deleted!',
            description: `"${name}" was successfully deleted.`,
            variant: 'default',
          })
          break
        case 'server':
          deleteServerAction(name)
          toast({
            title: 'Server deleted success!',
            description: `Server "${name}" was successfully deleted.`,
            variant: 'default',
          })
          break
        case 'remote-device':
          deleteRemoteDeviceAction(name)
          toast({
            title: 'Remote device deleted success!',
            description: `Remote device "${name}" was successfully deleted.`,
            variant: 'default',
          })
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

    // Deletions are soft and consistent across web and desktop: the element is
    // removed from the in-memory project, its file removal is queued in
    // `pendingDeletions`, and the workspace is flagged dirty (see deleteElement).
    // Nothing is written to disk until the user saves.
    closeModal()
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
