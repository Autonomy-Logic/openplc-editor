/* eslint-disable @typescript-eslint/no-misused-promises */
import * as PrimitivePopover from '@radix-ui/react-popover'
import { pinSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { FBDFlowState, LadderFlowState } from '@root/renderer/store/slices'
import { ProjectResponse } from '@root/renderer/store/slices/project'
import { extractSearchQuery } from '@root/renderer/store/slices/search/utils'
import type { PLCVariable } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext, RowData } from '@tanstack/react-table'
import { useCallback, useEffect, useRef, useState } from 'react'

import { InputWithRef } from '../../_atoms'
import { GenericComboboxCell } from '../../_atoms/generic-table-inputs'
import { getLadderPouVariablesRungNodeAndEdges } from '../../_atoms/graphical-editor/ladder/utils'
import { useToast } from '../../_features/[app]/toast/use-toast'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../modal'

declare module '@tanstack/react-table' {
  // This is a helper interface that adds the `updateData` property to the table meta.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnId: string, value: unknown) => ProjectResponse
  }
}

type IEditableCellProps = CellContext<PLCVariable, unknown> & { selected?: boolean; scope?: 'local' | 'global' }
const EditableNameCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = false,
  scope = 'local',
}: IEditableCellProps) => {
  const initialValue = getValue<string>()
  const { toast } = useToast()

  const {
    editor,
    ladderFlows,
    ladderFlowActions: { updateNode },
    fbdFlows,
    fbdFlowActions: { updateNode: updateFBDNode },
    searchQuery,
    projectActions: { getVariable },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)
  const [isEditing, setIsEditing] = useState(false)
  const [variable, setVariable] = useState<PLCVariable | undefined>(undefined)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const confirmResolveRef = useRef<(v: boolean) => void>()

  const isCellEditable = () => {
    if (id !== 'location' && id !== 'initialValue') return true

    // if (variable?.type.definition === 'derived') return false

    if (variable?.class === 'external') {
      return false
    }

    const disallowedLocationClasses = ['input', 'output', 'inOut', 'external', 'temp']

    if (id === 'location' && disallowedLocationClasses.includes(variable?.class || '')) {
      return false
    }

    return true
  }

  const isEditable = useCallback(isCellEditable, [id, variable])

  const askRenameBlocks = () =>
    new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve
      setConfirmOpen(true)
    })

  // Find all nodes in the ladder flows that use this variable
  const findNodesUsingVariable = (ladderFlows: LadderFlowState['ladderFlows'], varName: string) => {
    const lower = varName.toLowerCase()
    const matches: { rungId: string; nodeId: string }[] = []

    ladderFlows.forEach((flow) =>
      flow.rungs.forEach((rung) =>
        rung.nodes.forEach((node) => {
          const data = (node.data as { variable?: PLCVariable | { name?: string } }).variable
          if (data?.name?.toLowerCase() === lower) {
            matches.push({ rungId: rung.id, nodeId: node.id })
          }
        }),
      ),
    )

    return matches
  }

  const findNodesUsingVariableFbd = (fbdFlows: FBDFlowState['fbdFlows'], varName: string) => {
    const lower = varName.toLowerCase()
    const matches: { flowName: string; nodeId: string }[] = []

    fbdFlows.forEach((flow) => {
      flow.rung.nodes.forEach((node) => {
        const data = (node.data as { variable?: PLCVariable | { name?: string } }).variable
        if (data?.name?.toLowerCase() === lower) {
          matches.push({ flowName: flow.name, nodeId: node.id })
        }
      })
    })

    return matches
  }

  const onBlur = async () => {
    const language = 'language' in editor.meta ? editor.meta.language : undefined

    if (cellValue === initialValue) return setIsEditing(false)

    const oldName = initialValue
    const newName = cellValue

    /* 1 ▸ which blocks use the variable? */
    const nodesUsingVarLadder = findNodesUsingVariable(ladderFlows, oldName)
    const nodesUsingVarFbd = findNodesUsingVariableFbd(fbdFlows, oldName)

    let shouldPropagate = true
    if (nodesUsingVarLadder.length || nodesUsingVarFbd.length) {
      shouldPropagate = await askRenameBlocks()
    }

    /* 2 ▸ IF NOT propagating, break the link before renaming */
    if (nodesUsingVarLadder.length && !shouldPropagate && language === 'ld') {
      nodesUsingVarLadder.forEach(({ rungId, nodeId }) => {
        const { rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, { nodeId })
        if (!rung || !node) return

        const variableClone = {
          ...(node.data as { variable: PLCVariable }).variable,
          id: `broken-${nodeId}`,
          name: oldName,
        }

        updateNode({
          editorName: editor.meta.name,
          rungId,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: variableClone,
              wrongVariable: true,
            },
          },
        })
      })
    }

    if (nodesUsingVarFbd.length && !shouldPropagate && language === 'fbd') {
      nodesUsingVarFbd.forEach(({ flowName, nodeId }) => {
        const flow = fbdFlows.find((f) => f.name === flowName)
        if (!flow) return

        const node = flow.rung.nodes.find((n) => n.id === nodeId)
        if (!node) return

        const variableClone = {
          ...(node.data as { variable: PLCVariable }).variable,
          id: `broken-${nodeId}`,
          name: oldName,
        }

        updateFBDNode({
          editorName: editor.meta.name,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: variableClone,
              wrongVariable: true,
            },
          },
        })
      })
    }

    /* 3 ▸ Now rename it in the table */
    const res = table.options.meta?.updateData(index, id, newName)

    if (!res?.ok) {
      setCellValue(initialValue)
      toast({ title: res?.title, description: res?.message, variant: 'fail' })
      return
    }

    /* 4 ▸ If the user said YES, propagate the change to the blocks */
    if (nodesUsingVarLadder.length && shouldPropagate && language === 'ld') {
      nodesUsingVarLadder.forEach(({ rungId, nodeId }) => {
        const { rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, { nodeId })
        if (!rung || !node) return

        updateNode({
          editorName: editor.meta.name,
          rungId,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: { ...(node.data as { variable: PLCVariable }).variable, name: newName },
              wrongVariable: false,
            },
          },
        })
      })
    }

    if (nodesUsingVarFbd.length && shouldPropagate && language === 'fbd') {
      nodesUsingVarFbd.forEach(({ flowName, nodeId }) => {
        const flow = fbdFlows.find((f) => f.name === flowName)
        if (!flow) return

        const node = flow.rung.nodes.find((node) => node.id === nodeId)
        if (!node) return

        updateFBDNode({
          editorName: editor.meta.name,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: { ...(node.data as { variable: PLCVariable }).variable, name: newName },
              wrongVariable: false,
            },
          },
        })
      })
    }

    setIsEditing(false)
  }

  const handleStartEditing = () => {
    if (!isEditable()) return
    setIsEditing(true)
  }

  const formattedCellValue = searchQuery && cellValue ? extractSearchQuery(cellValue, searchQuery) : cellValue

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    setVariable(
      getVariable({
        variableId: table.options.data[index].id,
        scope,
        associatedPou: editor.meta.name,
      }),
    )
  }, [editor.meta.name, index, table.options.data, scope, getVariable])

  return (
    <>
      {confirmOpen && (
        <Modal open>
          <ModalContent
            className='flex h-48 w-[496px] select-none flex-col justify-between gap-2 rounded-lg p-8'
            onClose={() => {
              confirmResolveRef.current?.(false)
              setConfirmOpen(false)
            }}
          >
            <ModalHeader>
              <ModalTitle className='text-sm font-medium text-neutral-950 dark:text-white'>
                Rename references
              </ModalTitle>
            </ModalHeader>

            <p className='text-xs text-neutral-600 dark:text-neutral-50'>
              You renamed one or more variables. Do you want to propagate those new names to all elements that reference
              the old names?
            </p>

            <ModalFooter className='mt-auto flex justify-end gap-2'>
              <button
                onClick={() => {
                  confirmResolveRef.current?.(false)
                  setConfirmOpen(false)
                }}
                className='h-8 w-full rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
              >
                No, keep references unchanged
              </button>
              <button
                onClick={() => {
                  confirmResolveRef.current?.(true)
                  setConfirmOpen(false)
                }}
                className='h-8 w-full rounded bg-brand px-3 py-1 text-xs text-white'
              >
                Yes, rename references
              </button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {isEditing ? (
        <InputWithRef
          value={cellValue}
          onChange={(e) => setCellValue(e.target.value)}
          onBlur={void onBlur}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none')}
        />
      ) : (
        <div
          onClick={handleStartEditing}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
            'pointer-events-none': !selected,
            'cursor-not-allowed': !isEditable(),
          })}
        >
          <p
            className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {})}
            dangerouslySetInnerHTML={{ __html: formattedCellValue }}
          />
        </div>
      )}
    </>
  )
}

const EditableInitialValueCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = false,
  scope = 'local',
}: IEditableCellProps) => {
  const initialValue = getValue<string>()
  const { toast } = useToast()

  const {
    editor,
    ladderFlows,
    ladderFlowActions: { updateNode },
    fbdFlows,
    fbdFlowActions: { updateNode: updateFBDNode },
    searchQuery,
    projectActions: { getVariable },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)
  const [isEditing, setIsEditing] = useState(false)
  const [variable, setVariable] = useState<PLCVariable | undefined>(undefined)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const confirmResolveRef = useRef<(v: boolean) => void>()

  const isCellEditable = () => {
    if (id !== 'location' && id !== 'initialValue') return true

    // if (variable?.type.definition === 'derived') return false

    if (variable?.class === 'external') {
      return false
    }

    const disallowedLocationClasses = ['input', 'output', 'inOut', 'external', 'temp']

    if (id === 'location' && disallowedLocationClasses.includes(variable?.class || '')) {
      return false
    }

    return true
  }

  const isEditable = useCallback(isCellEditable, [id, variable])

  const askRenameBlocks = () =>
    new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve
      setConfirmOpen(true)
    })

  // Find all nodes in the ladder flows that use this variable
  const findNodesUsingVariable = (ladderFlows: LadderFlowState['ladderFlows'], varName: string) => {
    const lower = varName.toLowerCase()
    const matches: { rungId: string; nodeId: string }[] = []

    ladderFlows.forEach((flow) =>
      flow.rungs.forEach((rung) =>
        rung.nodes.forEach((node) => {
          const data = (node.data as { variable?: PLCVariable | { name?: string } }).variable
          if (data?.name?.toLowerCase() === lower) {
            matches.push({ rungId: rung.id, nodeId: node.id })
          }
        }),
      ),
    )

    return matches
  }

  const findNodesUsingVariableFbd = (fbdFlows: FBDFlowState['fbdFlows'], varName: string) => {
    const lower = varName.toLowerCase()
    const matches: { flowName: string; nodeId: string }[] = []

    fbdFlows.forEach((flow) => {
      flow.rung.nodes.forEach((node) => {
        const data = (node.data as { variable?: PLCVariable | { name?: string } }).variable
        if (data?.name?.toLowerCase() === lower) {
          matches.push({ flowName: flow.name, nodeId: node.id })
        }
      })
    })

    return matches
  }

  const onBlur = async () => {
    const language = 'language' in editor.meta ? editor.meta.language : undefined

    if (cellValue === initialValue) return setIsEditing(false)

    const oldName = initialValue
    const newName = cellValue

    /* 1 ▸ which blocks use the variable? */
    const nodesUsingVarLadder = findNodesUsingVariable(ladderFlows, oldName)
    const nodesUsingVarFbd = findNodesUsingVariableFbd(fbdFlows, oldName)

    let shouldPropagate = true
    if (nodesUsingVarLadder.length || nodesUsingVarFbd.length) {
      shouldPropagate = await askRenameBlocks()
    }

    /* 2 ▸ IF NOT propagating, break the link before renaming */
    if (nodesUsingVarLadder.length && !shouldPropagate && language === 'ld') {
      nodesUsingVarLadder.forEach(({ rungId, nodeId }) => {
        const { rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, { nodeId })
        if (!rung || !node) return

        const variableClone = {
          ...(node.data as { variable: PLCVariable }).variable,
          id: `broken-${nodeId}`,
          name: oldName,
        }

        updateNode({
          editorName: editor.meta.name,
          rungId,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: variableClone,
              wrongVariable: true,
            },
          },
        })
      })
    }

    if (nodesUsingVarFbd.length && !shouldPropagate && language === 'fbd') {
      nodesUsingVarFbd.forEach(({ flowName, nodeId }) => {
        const flow = fbdFlows.find((f) => f.name === flowName)
        if (!flow) return

        const node = flow.rung.nodes.find((n) => n.id === nodeId)
        if (!node) return

        const variableClone = {
          ...(node.data as { variable: PLCVariable }).variable,
          id: `broken-${nodeId}`,
          name: oldName,
        }

        updateFBDNode({
          editorName: editor.meta.name,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: variableClone,
              wrongVariable: true,
            },
          },
        })
      })
    }

    /* 3 ▸ Now rename it in the table */
    const res = table.options.meta?.updateData(index, id, newName)

    if (!res?.ok) {
      setCellValue(initialValue)
      toast({ title: res?.title, description: res?.message, variant: 'fail' })
      return
    }

    /* 4 ▸ If the user said YES, propagate the change to the blocks */
    if (nodesUsingVarLadder.length && shouldPropagate && language === 'ld') {
      nodesUsingVarLadder.forEach(({ rungId, nodeId }) => {
        const { rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, { nodeId })
        if (!rung || !node) return

        updateNode({
          editorName: editor.meta.name,
          rungId,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: { ...(node.data as { variable: PLCVariable }).variable, name: newName },
              wrongVariable: false,
            },
          },
        })
      })
    }

    if (nodesUsingVarFbd.length && shouldPropagate && language === 'fbd') {
      nodesUsingVarFbd.forEach(({ flowName, nodeId }) => {
        const flow = fbdFlows.find((f) => f.name === flowName)
        if (!flow) return

        const node = flow.rung.nodes.find((node) => node.id === nodeId)
        if (!node) return

        updateFBDNode({
          editorName: editor.meta.name,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: { ...(node.data as { variable: PLCVariable }).variable, name: newName },
              wrongVariable: false,
            },
          },
        })
      })
    }

    setIsEditing(false)
  }

  const handleStartEditing = () => {
    if (!isEditable()) return
    setIsEditing(true)
  }

  const formattedCellValue = searchQuery && cellValue ? extractSearchQuery(cellValue, searchQuery) : cellValue

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    setVariable(
      getVariable({
        variableId: table.options.data[index].id,
        scope,
        associatedPou: editor.meta.name,
      }),
    )
  }, [editor.meta.name, index, table.options.data, scope, getVariable])

  return (
    <>
      {confirmOpen && (
        <Modal open>
          <ModalContent
            className='flex h-48 w-[496px] select-none flex-col justify-between gap-2 rounded-lg p-8'
            onClose={() => {
              confirmResolveRef.current?.(false)
              setConfirmOpen(false)
            }}
          >
            <ModalHeader>
              <ModalTitle className='text-sm font-medium text-neutral-950 dark:text-white'>
                Rename references
              </ModalTitle>
            </ModalHeader>

            <p className='text-xs text-neutral-600 dark:text-neutral-50'>
              You renamed one or more variables. Do you want to propagate those new names to all elements that reference
              the old names?
            </p>

            <ModalFooter className='mt-auto flex justify-end gap-2'>
              <button
                onClick={() => {
                  confirmResolveRef.current?.(false)
                  setConfirmOpen(false)
                }}
                className='h-8 w-full rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
              >
                No, keep references unchanged
              </button>
              <button
                onClick={() => {
                  confirmResolveRef.current?.(true)
                  setConfirmOpen(false)
                }}
                className='h-8 w-full rounded bg-brand px-3 py-1 text-xs text-white'
              >
                Yes, rename references
              </button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {isEditing ? (
        <InputWithRef
          value={cellValue}
          onChange={(e) => setCellValue(e.target.value)}
          onBlur={onBlur}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none')}
        />
      ) : (
        <div
          onClick={handleStartEditing}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
            'pointer-events-none': !selected,
            'cursor-not-allowed': !isEditable(),
          })}
        >
          <p
            className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {})}
            dangerouslySetInnerHTML={{ __html: formattedCellValue }}
          />
        </div>
      )}
    </>
  )
}

const EditableInitialValueCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = false,
  scope = 'local',
}: IEditableCellProps) => {
  const initialValue = getValue<string>()
  const { toast } = useToast()

  const {
    editor,
    ladderFlows,
    ladderFlowActions: { updateNode },
    fbdFlows,
    fbdFlowActions: { updateNode: updateFBDNode },
    searchQuery,
    projectActions: { getVariable },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)
  const [isEditing, setIsEditing] = useState(false)
  const [variable, setVariable] = useState<PLCVariable | undefined>(undefined)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const confirmResolveRef = useRef<(v: boolean) => void>()

  const isCellEditable = () => {
    if (id !== 'location' && id !== 'initialValue') return true

    // if (variable?.type.definition === 'derived') return false

    if (variable?.class === 'external') {
      return false
    }

    const disallowedLocationClasses = ['input', 'output', 'inOut', 'external', 'temp']

    if (id === 'location' && disallowedLocationClasses.includes(variable?.class || '')) {
      return false
    }

    return true
  }

  const isEditable = useCallback(isCellEditable, [id, variable])

  const askRenameBlocks = () =>
    new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve
      setConfirmOpen(true)
    })

  // Find all nodes in the ladder flows that use this variable
  const findNodesUsingVariable = (ladderFlows: LadderFlowState['ladderFlows'], varName: string) => {
    const lower = varName.toLowerCase()
    const matches: { rungId: string; nodeId: string }[] = []

    ladderFlows.forEach((flow) =>
      flow.rungs.forEach((rung) =>
        rung.nodes.forEach((node) => {
          const data = (node.data as { variable?: PLCVariable | { name?: string } }).variable
          if (data?.name?.toLowerCase() === lower) {
            matches.push({ rungId: rung.id, nodeId: node.id })
          }
        }),
      ),
    )

    return matches
  }

  const findNodesUsingVariableFbd = (fbdFlows: FBDFlowState['fbdFlows'], varName: string) => {
    const lower = varName.toLowerCase()
    const matches: { flowName: string; nodeId: string }[] = []

    fbdFlows.forEach((flow) => {
      flow.rung.nodes.forEach((node) => {
        const data = (node.data as { variable?: PLCVariable | { name?: string } }).variable
        if (data?.name?.toLowerCase() === lower) {
          matches.push({ flowName: flow.name, nodeId: node.id })
        }
      })
    })

    return matches
  }

  const onBlur = async () => {
    const language = 'language' in editor.meta ? editor.meta.language : undefined

    if (cellValue === initialValue) return setIsEditing(false)

    const oldName = initialValue
    const newName = cellValue

    /* 1 ▸ which blocks use the variable? */
    const nodesUsingVarLadder = findNodesUsingVariable(ladderFlows, oldName)
    const nodesUsingVarFbd = findNodesUsingVariableFbd(fbdFlows, oldName)

    let shouldPropagate = true
    if (nodesUsingVarLadder.length || nodesUsingVarFbd.length) {
      shouldPropagate = await askRenameBlocks()
    }

    /* 2 ▸ IF NOT propagating, break the link before renaming */
    if (nodesUsingVarLadder.length && !shouldPropagate && language === 'ld') {
      nodesUsingVarLadder.forEach(({ rungId, nodeId }) => {
        const { rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, { nodeId })
        if (!rung || !node) return

        const variableClone = {
          ...(node.data as { variable: PLCVariable }).variable,
          id: `broken-${nodeId}`,
          name: oldName,
        }

        updateNode({
          editorName: editor.meta.name,
          rungId,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: variableClone,
              wrongVariable: true,
            },
          },
        })
      })
    }

    if (nodesUsingVarFbd.length && !shouldPropagate && language === 'fbd') {
      nodesUsingVarFbd.forEach(({ flowName, nodeId }) => {
        const flow = fbdFlows.find((f) => f.name === flowName)
        if (!flow) return

        const node = flow.rung.nodes.find((n) => n.id === nodeId)
        if (!node) return

        const variableClone = {
          ...(node.data as { variable: PLCVariable }).variable,
          id: `broken-${nodeId}`,
          name: oldName,
        }

        updateFBDNode({
          editorName: editor.meta.name,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: variableClone,
              wrongVariable: true,
            },
          },
        })
      })
    }

    /* 3 ▸ Now rename it in the table */
    const res = table.options.meta?.updateData(index, id, newName)

    if (!res?.ok) {
      setCellValue(initialValue)
      toast({ title: res?.title, description: res?.message, variant: 'fail' })
      return
    }

    /* 4 ▸ If the user said YES, propagate the change to the blocks */
    if (nodesUsingVarLadder.length && shouldPropagate && language === 'ld') {
      nodesUsingVarLadder.forEach(({ rungId, nodeId }) => {
        const { rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, { nodeId })
        if (!rung || !node) return

        updateNode({
          editorName: editor.meta.name,
          rungId,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: { ...(node.data as { variable: PLCVariable }).variable, name: newName },
              wrongVariable: false,
            },
          },
        })
      })
    }

    if (nodesUsingVarFbd.length && shouldPropagate && language === 'fbd') {
      nodesUsingVarFbd.forEach(({ flowName, nodeId }) => {
        const flow = fbdFlows.find((f) => f.name === flowName)
        if (!flow) return

        const node = flow.rung.nodes.find((node) => node.id === nodeId)
        if (!node) return

        updateFBDNode({
          editorName: editor.meta.name,
          nodeId,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: { ...(node.data as { variable: PLCVariable }).variable, name: newName },
              wrongVariable: false,
            },
          },
        })
      })
    }

    setIsEditing(false)
  }

  const handleStartEditing = () => {
    if (!isEditable()) return
    setIsEditing(true)
  }

  const formattedCellValue = searchQuery && cellValue ? extractSearchQuery(cellValue, searchQuery) : cellValue

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    setVariable(
      getVariable({
        variableId: table.options.data[index].id,
        scope,
        associatedPou: editor.meta.name,
      }),
    )
  }, [editor.meta.name, index, table.options.data, scope, getVariable])

  return (
    <>
      {confirmOpen && (
        <Modal open>
          <ModalContent
            className='flex h-48 w-[496px] select-none flex-col justify-between gap-2 rounded-lg p-8'
            onClose={() => {
              confirmResolveRef.current?.(false)
              setConfirmOpen(false)
            }}
          >
            <ModalHeader>
              <ModalTitle className='text-sm font-medium text-neutral-950 dark:text-white'>
                Rename references
              </ModalTitle>
            </ModalHeader>

            <p className='text-xs text-neutral-600 dark:text-neutral-50'>
              You renamed one or more variables. Do you want to propagate those new names to all elements that reference
              the old names?
            </p>

            <ModalFooter className='mt-auto flex justify-end gap-2'>
              <button
                onClick={() => {
                  confirmResolveRef.current?.(false)
                  setConfirmOpen(false)
                }}
                className='h-8 w-full rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
              >
                No, keep references unchanged
              </button>
              <button
                onClick={() => {
                  confirmResolveRef.current?.(true)
                  setConfirmOpen(false)
                }}
                className='h-8 w-full rounded bg-brand px-3 py-1 text-xs text-white'
              >
                Yes, rename references
              </button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {isEditing ? (
        <InputWithRef
          value={cellValue}
          onChange={(e) => setCellValue(e.target.value)}
          onBlur={onBlur}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none')}
        />
      ) : (
        <div
          onClick={handleStartEditing}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
            'pointer-events-none': !selected,
            'cursor-not-allowed': !isEditable(),
          })}
        >
          <p
            className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {})}
            dangerouslySetInnerHTML={{ __html: formattedCellValue }}
          />
        </div>
      )}
    </>
  )
}

const EditableLocationCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = false,
  scope = 'local',
}: IEditableCellProps) => {
  const initialValue = getValue<string>()
  const { toast } = useToast()

  const {
    editor,
    searchQuery,
    projectActions: { getVariable },
  } = useOpenPLCStore()
  const existingPins = pinSelectors.usePins()

  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)
  // const [isEditing, setIsEditing] = useState(false)
  const [variable, setVariable] = useState<PLCVariable | undefined>(undefined)

  const isCellEditable = () => {
    const disallowedLocationClasses = ['input', 'output', 'inOut', 'external', 'temp']
    if (id === 'location' && disallowedLocationClasses.includes(variable?.class || '')) {
      return false
    }

    return true
  }

  const isEditable = useCallback(isCellEditable, [id, variable])

  // When the input is blurred, we'll call our table meta's updateData function
  const onBlur = (value: string) => {
    if (value === initialValue) return
    const res = table.options.meta?.updateData(index, id, value)
    if (res?.ok) {
      setCellValue(value)
      return
    }
    setCellValue(initialValue)
    toast({ title: res?.title, description: res?.message, variant: 'fail' })
  }

  const formattedCellValue = searchQuery && cellValue ? extractSearchQuery(cellValue, searchQuery) : cellValue

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    setVariable(
      getVariable({
        variableId: table.options.data[index].id,
        scope,
        associatedPou: editor.meta.name,
      }),
    )
  }, [editor.meta.name, index, table.options.data, scope, getVariable])

  const selectableValues = useCallback(() => {
    const ainPins = existingPins
      .filter((pin) => pin.pinType === 'analogInput')
      .map((pin) => ({
        id: `${id}-${pin.pin}`,
        value: pin.address,
        label: `${pin.address} ${pin.name ? `(${pin.name})` : ''}`,
      }))
    const aoutPins = existingPins
      .filter((pin) => pin.pinType === 'analogOutput')
      .map((pin) => ({
        id: `${id}-${pin.pin}`,
        value: pin.address,
        label: `${pin.address} ${pin.name ? `(${pin.name})` : ''}`,
      }))

    const dinPins = existingPins
      .filter((pin) => pin.pinType === 'digitalInput')
      .map((pin) => ({
        id: `${id}-${pin.pin}`,
        value: pin.address,
        label: `${pin.address} ${pin.name ? `(${pin.name})` : ''}`,
      }))

    const doutPins = existingPins
      .filter((pin) => pin.pinType === 'digitalOutput')
      .map((pin) => ({
        id: `${id}-${pin.pin}`,
        value: pin.address,
        label: `${pin.address} ${pin.name ? `(${pin.name})` : ''}`,
      }))

    return [
      { label: 'Analog Inputs', options: ainPins },
      { label: 'Analog Outputs', options: aoutPins },
      { label: 'Digital Inputs', options: dinPins },
      { label: 'Digital Outputs', options: doutPins },
    ]
  }, [id, variable, existingPins])

  return selected ? (
    <GenericComboboxCell
      value={cellValue}
      onValueChange={(value) => {
        onBlur(value)
      }}
      selectValues={selectableValues()}
      selected={selected}
      openOnSelectedOption
      canAddACustomOption
    />
  ) : (
    <div
      className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
        'pointer-events-none': !selected,
        'cursor-not-allowed': !isEditable(),
      })}
    >
      <p
        className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {})}
        dangerouslySetInnerHTML={{ __html: formattedCellValue }}
      />
    </div>
  )
}

const EditableDocumentationCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = true,
}: IEditableCellProps) => {
  const initialValue = getValue<string | undefined>()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue ?? '')

  // When the input is blurred, we'll call our table meta's updateData function
  const onBlur = () => {
    table.options.meta?.updateData(index, id, cellValue)
  }
  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue ?? '')
  }, [initialValue])

  return (
    <PrimitivePopover.Root>
      <PrimitivePopover.Trigger asChild>
        <div
          className={cn('flex h-full w-full cursor-text items-center justify-center p-2', {
            'pointer-events-none': !selected,
          })}
        >
          <p className='h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all'>{cellValue}</p>
        </div>
      </PrimitivePopover.Trigger>
      <PrimitivePopover.Portal>
        <PrimitivePopover.Content
          align='center'
          side='bottom'
          sideOffset={-32}
          className='box h-fit w-[175px] rounded-lg bg-white p-2 lg:w-[275px] 2xl:w-[375px] dark:bg-neutral-950'
          onInteractOutside={onBlur}
        >
          <textarea
            value={cellValue}
            onChange={(e) => setCellValue(e.target.value)}
            rows={5}
            className='w-full max-w-[375px] flex-1 resize-none  bg-transparent text-start text-neutral-900 outline-none  dark:text-neutral-100'
          />
        </PrimitivePopover.Content>
      </PrimitivePopover.Portal>
    </PrimitivePopover.Root>
  )
}

export { EditableDocumentationCell, EditableInitialValueCell, EditableLocationCell, EditableNameCell }
