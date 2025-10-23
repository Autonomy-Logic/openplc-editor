import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { sharedSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import {
  FBDFlowActions,
  FBDFlowState,
  LadderFlowActions,
  LadderFlowState,
  VariablesTable as VariablesTableType,
} from '@root/renderer/store/slices'
import { baseTypes } from '@root/shared/data'
import { PLCVariable as VariablePLC } from '@root/types/PLC'
import { BaseType, PLCVariable } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { parseIecStringToVariables } from '@root/utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '@root/utils/generate-iec-variables-to-string'
import { ColumnFiltersState } from '@tanstack/react-table'
import { Node } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'

import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import TableActions from '../../_atoms/table-actions'
import { toast } from '../../_features/[app]/toast/use-toast'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle, VariablesTable } from '../../_molecules'
import { VariablesCodeEditor } from '../variables-code-editor'

const VariablesEditor = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    ladderFlows,
    ladderFlowActions: { updateNode },
    fbdFlows,
    fbdFlowActions: { updateNode: updateFBDNode },
    workspace: {
      systemConfigs: { shouldUseDarkMode },
      isDebuggerVisible,
    },
    project: {
      data: { pous, dataTypes },
    },
    libraries,
    editorActions: { updateModelVariables },
    projectActions: {
      createVariable,
      deleteVariable,
      rearrangeVariables,
      updatePouDocumentation,
      updatePouReturnType,
      setPouVariables,
    },
    snapshotActions: { addSnapshot },
  } = useOpenPLCStore()

  const handleFileAndWorkspaceSavedState = sharedSelectors.useHandleFileAndWorkspaceSavedState()

  /**
   * Table data and column filters states to keep track of the table data and column filters
   */
  const [tableData, setTableData] = useState<PLCVariable[]>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [returnType, setReturnType] = useState('BOOL')
  const [returnTypeOptions, setReturnTypeOptions] = useState<string[]>([])
  const [editorCode, setEditorCode] = useState(() => generateIecVariablesToString(tableData as VariablePLC[]))
  const [parseError, setParseError] = useState<string | null>(null)
  const [pouDescription, setPouDescription] = useState<string>('')
  const [confirmRenameBlocksOpen, setConfirmRenameBlocksOpen] = useState(false)
  const confirmRenameBlocksResolveRef = useRef<(v: boolean) => void>()

  /**
   * Editor name state to keep track of the editor name
   * Other states to keep track of the editor's variables and display at the screen
   */
  const FilterOptions = ['All', 'Local', 'Input', 'Output', 'InOut', 'External', 'Temp'] as const
  type FilterOptionsType = (typeof FilterOptions)[number]
  const [editorVariables, setEditorVariables] = useState<VariablesTableType>({
    display: 'table',
    selectedRow: ROWS_NOT_SELECTED.toString(),
    classFilter: 'All',
    description: '',
  })

  const pou = pous.find((p) => p.data.name === editor.meta.name)
  useEffect(() => {
    const data = pou?.data.documentation
    if (data) setPouDescription(data)
    return () => {
      setPouDescription('')
    }
  }, [editor, pou?.data.documentation])

  /**
   * Update the table data and the editor's variables when the editor or the pous change
   */
  useEffect(() => {
    if (pou) {
      setTableData(pou.data.variables)
      if (pou.type === 'function') {
        setReturnType(pou.data.returnType)
      }
    } else {
      setTableData([])
    }
  }, [editor, pou])

  /**
   * Update the return type options when the data types change
   */
  useEffect(() => {
    const combinedReturnTypeOptions = [...baseTypes, ...dataTypes.map((type) => type.name)]
    setReturnTypeOptions(combinedReturnTypeOptions)
  }, [dataTypes])

  useEffect(() => {
    setEditorCode(generateIecVariablesToString(tableData as VariablePLC[]))
  }, [tableData])

  /**
   * If the editor name is not the same as the current editor name
   * set the editor name and the editor's variables to the states
   */
  useEffect(() => {
    if (editor.type === 'plc-textual' || editor.type === 'plc-graphical')
      if (editor.variable.display === 'table') {
        const { classFilter, description, display, selectedRow } = editor.variable
        setEditorVariables({
          display: display,
          selectedRow: selectedRow,
          classFilter: classFilter,
          description: description,
        })
        setColumnFilters((prev) =>
          classFilter !== 'All'
            ? prev.filter((filter) => filter.id !== 'class').concat({ id: 'class', value: classFilter.toLowerCase() })
            : prev.filter((filter) => filter.id !== 'class'),
        )
      } else
        setEditorVariables({
          display: editor.variable.display,
        })
  }, [editor])

  const handleVisualizationTypeChange = async (value: 'code' | 'table') => {
    if (editorVariables.display === 'code' && value === 'table') {
      const success = await commitCode()
      if (!success) return
    }

    updateModelVariables({
      display: value,
    })
  }

  const handleRearrangeVariables = (index: number, row?: number) => {
    if (editorVariables.display === 'code') return

    addSnapshot(editor.meta.name)

    const currentIndex = row ?? parseInt(editorVariables.selectedRow)
    rearrangeVariables({
      scope: 'local',
      associatedPou: editor.meta.name,
      rowId: currentIndex,
      newIndex: currentIndex + index,
    })
    updateModelVariables({
      display: 'table',
      selectedRow: parseInt(editorVariables.selectedRow) + index,
    })
  }

  const handleCreateVariable = () => {
    if (editorVariables.display === 'code') return

    addSnapshot(editor.meta.name)

    const variables = pous.filter((pou) => pou.data.name === editor.meta.name)[0].data.variables
    const selectedRow = parseInt(editorVariables.selectedRow)

    if (variables.length === 0) {
      createVariable({
        scope: 'local',
        associatedPou: editor.meta.name,
        data: {
          name: 'LocalVar',
          class: 'local',
          type: { definition: 'base-type', value: 'dint' },
          location: '',
          documentation: '',
          debug: false,
        },
      })
      updateModelVariables({
        display: 'table',
        selectedRow: 0,
      })
      handleFileAndWorkspaceSavedState(editor.meta.name)
      return
    }

    const variable: PLCVariable =
      selectedRow === ROWS_NOT_SELECTED ? variables[variables.length - 1] : variables[selectedRow]

    if (selectedRow === ROWS_NOT_SELECTED) {
      createVariable({
        scope: 'local',
        associatedPou: editor.meta.name,
        data: {
          ...variable,
          type: variable.type.definition === 'derived' ? { definition: 'base-type', value: 'dint' } : variable.type,
        },
      })
      updateModelVariables({
        display: 'table',
        selectedRow: variables.length,
      })
      handleFileAndWorkspaceSavedState(editor.meta.name)
      return
    }
    createVariable({
      scope: 'local',
      associatedPou: editor.meta.name,
      data: {
        ...variable,
        type: variable.type.definition === 'derived' ? { definition: 'base-type', value: 'dint' } : variable.type,
      },
      rowToInsert: selectedRow + 1,
    })
    updateModelVariables({
      display: 'table',
      selectedRow: selectedRow + 1,
    })
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const handleRemoveVariable = () => {
    if (editorVariables.display === 'code') return

    addSnapshot(editor.meta.name)

    const selectedRow = parseInt(editorVariables.selectedRow)
    deleteVariable({ scope: 'local', associatedPou: editor.meta.name, rowId: selectedRow })

    const variables = pous.filter((pou) => pou.data.name === editor.meta.name)[0].data.variables
    if (selectedRow === variables.length - 1) {
      updateModelVariables({
        display: 'table',
        selectedRow: selectedRow - 1,
      })
    }
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const handleFilterChange = (value: FilterOptionsType) => {
    setColumnFilters((prev) =>
      value !== 'All'
        ? prev.filter((filter) => filter.id !== 'class').concat({ id: 'class', value: value.toLowerCase() })
        : prev.filter((filter) => filter.id !== 'class'),
    )
    updateModelVariables({
      display: 'table',
      classFilter: value,
    })
  }

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelVariables({
      display: 'table',
      selectedRow: parseInt(row.id),
    })
  }

  const handleReturnTypeChange = (value: BaseType) => {
    updatePouReturnType(editor.meta.name, value)
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  // const forbiddenVariableToBeRemoved =
  //   editorVariables.display === 'table' &&
  //   tableData[parseInt(editorVariables.selectedRow)]?.type.definition === 'derived' &&
  //   editor?.type !== 'plc-textual'

  const handleDescriptionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.preventDefault()
    event.stopPropagation()
    updatePouDocumentation(editor.meta.name, event.target.value)
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const handleDescriptionValueChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setPouDescription(event.target.value)
  }

  const askRenameBlocks = () =>
    new Promise<boolean>((resolve) => {
      confirmRenameBlocksResolveRef.current = resolve
      setConfirmRenameBlocksOpen(true)
    })

  const unlinkRenamedVariablesByNameFBD = (
    renamedPairs: { oldName: string; type: string }[],
    fbdFlows: FBDFlowState['fbdFlows'],
    updateNode: FBDFlowActions['updateNode'],
  ) => {
    addSnapshot(editor.meta.name)
    fbdFlows.forEach((flow) =>
      flow.rung.nodes.forEach((node) => {
        const data = (node.data as { variable?: PLCVariable }).variable
        if (!data) return

        const renamed = renamedPairs.find(
          (p) => p.oldName.toLowerCase() === data.name.toLowerCase() && p.type === data.type.value.toLowerCase(),
        )
        if (!renamed) return

        updateNode({
          editorName: flow.name,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: { ...data, id: `broken-${node.id}` },
              wrongVariable: true,
            },
          },
        })
      }),
    )
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const unlinkRenamedVariablesByName = (
    renamedPairs: { oldName: string; type: string }[],
    ladderFlows: LadderFlowState['ladderFlows'],
    updateNode: LadderFlowActions['updateNode'],
  ) => {
    addSnapshot(editor.meta.name)

    ladderFlows.forEach((flow) =>
      flow.rungs.forEach((rung) =>
        rung.nodes.forEach((node) => {
          const data = (node.data as { variable?: PLCVariable }).variable
          if (!data) return

          const renamed = renamedPairs.find(
            (p) => p.oldName.toLowerCase() === data.name.toLowerCase() && p.type === data.type.value.toLowerCase(),
          )
          if (!renamed) return

          updateNode({
            editorName: flow.name,
            rungId: rung.id,
            nodeId: node.id,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: { ...data, id: `broken-${node.id}` },
                wrongVariable: true,
              },
            },
          })
        }),
      ),
    )
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const relinkVariablesByName = (
    renamedPairs: { oldName: string; newName: string; type: string }[],
    newVariables: PLCVariable[],
    ladderFlows: LadderFlowState['ladderFlows'],
    updateNode: LadderFlowActions['updateNode'],
    propagateRenamed: boolean,
  ): void => {
    addSnapshot(editor.meta.name)

    ladderFlows.forEach((flow) =>
      flow.rungs.forEach((rung) =>
        rung.nodes.forEach((node) => {
          const nodeVar = (node.data as { variable?: PLCVariable }).variable

          if (!nodeVar?.name) {
            return
          }

          const pair = renamedPairs.find((p) => p.oldName.toLowerCase() === nodeVar.name.toLowerCase())

          if (pair && !propagateRenamed) {
            return
          }

          const targetName = pair ? pair.newName : nodeVar.name

          const target = newVariables.find((v) => v.name.toLowerCase() === targetName.toLowerCase())

          if (!target || target === nodeVar) {
            return
          }

          const expectedType = getBlockExpectedType(node)

          if (!sameType(target.type.value, expectedType)) {
            return
          }

          updateNode({
            editorName: flow.name,
            rungId: rung.id,
            nodeId: node.id,
            node: {
              ...node,
              data: { ...node.data, variable: target, wrongVariable: false },
            },
          })
        }),
      ),
    )
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const relinkVariablesByNameFBD = (
    renamedPairs: { oldName: string; newName: string; type: string }[],
    newVariables: PLCVariable[],
    fbdFlows: FBDFlowState['fbdFlows'],
    updateNode: FBDFlowActions['updateNode'],
    propagateRenamed: boolean,
  ): void => {
    addSnapshot(editor.meta.name)

    fbdFlows.forEach((flow) =>
      flow.rung.nodes.forEach((node) => {
        const nodeVar = (node.data as { variable?: PLCVariable }).variable

        if (!nodeVar?.name) {
          return
        }

        const pair = renamedPairs.find((p) => p.oldName.toLowerCase() === nodeVar.name.toLowerCase())

        if (pair && !propagateRenamed) {
          return
        }

        const targetName = pair ? pair.newName : nodeVar.name

        const target = newVariables.find((v) => v.name.toLowerCase() === targetName.toLowerCase())

        if (!target || target === nodeVar) {
          return
        }

        const expectedType = getBlockExpectedType(node)

        if (!sameType(target.type.value, expectedType)) {
          return
        }

        updateNode({
          editorName: flow.name,
          nodeId: node.id,
          node: {
            ...node,
            data: { ...node.data, variable: target, wrongVariable: false },
          },
        })
      }),
    )
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const getBlockExpectedType = (node: Node): string => {
    const variant = (node.data as { variant?: { name?: string } }).variant

    if (variant && typeof variant.name === 'string') {
      return variant.name.trim().toUpperCase()
    }

    return ''
  }

  const sameType = (firstType: string, secondType: string) =>
    firstType.toString().trim().toLowerCase() === secondType.toString().trim().toLowerCase()

  const applyVariableToNode = (
    variable: PLCVariable,
    nodeId: string,
    editorName: string,
    ladderFlows: LadderFlowState['ladderFlows'],
    updateNode: LadderFlowActions['updateNode'],
  ) => {
    let targetFlow = null
    let targetRung = null
    let targetNode = null

    for (const flow of ladderFlows) {
      if (flow.name === editorName) {
        for (const rung of flow.rungs) {
          const node = rung.nodes.find((node) => node.id === nodeId)

          if (node) {
            targetFlow = flow
            targetRung = rung
            targetNode = node

            break
          }
        }

        if (targetNode) {
          break
        }
      }
    }

    if (!targetFlow || !targetRung || !targetNode) {
      return
    }

    updateNode({
      editorName: editorName,
      rungId: targetRung.id,
      nodeId: targetNode.id,
      node: {
        ...targetNode,
        data: {
          ...targetNode.data,
          variable: variable,
          wrongVariable: false,
        },
      },
    })
  }

  const applyVariableToNodeFBD = (
    variable: PLCVariable,
    nodeId: string,
    editorName: string,
    fbdFlows: FBDFlowState['fbdFlows'],
    updateNode: FBDFlowActions['updateNode'],
  ) => {
    let targetFlow = null
    let targetNode = null

    for (const flow of fbdFlows) {
      if (flow.name === editorName) {
        const node = flow.rung.nodes.find((n) => n.id === nodeId)
        if (node) {
          targetFlow = flow
          targetNode = node
          break
        }
      }
    }

    if (!targetFlow || !targetNode) {
      return
    }

    updateNode({
      editorName: editorName,
      nodeId: targetNode.id,
      node: {
        ...targetNode,
        data: {
          ...targetNode.data,
          variable: variable,
          wrongVariable: false,
        },
      },
    })
  }

  const syncNodesWithVariables = (
    newVars: PLCVariable[],
    ladderFlows: LadderFlowState['ladderFlows'],
    updateNode: LadderFlowActions['updateNode'],
  ) => {
    ladderFlows.forEach((flow) => {
      flow.rungs.forEach((rung) => {
        rung.nodes.forEach((node) => {
          const nodeVar = (node.data as { variable?: PLCVariable }).variable

          if (!nodeVar || !nodeVar.name) {
            return
          }

          const selectedVariable = newVars.find(
            (variable) => variable.name.toLowerCase() === nodeVar.name.toLowerCase(),
          )

          if (!selectedVariable) {
            updateNode({
              editorName: flow.name,
              rungId: rung.id,
              nodeId: node.id,
              node: {
                ...node,
                data: {
                  ...node.data,
                  variable: { ...nodeVar, id: `broken-${node.id}` },
                  wrongVariable: true,
                },
              },
            })
            return
          }

          if (node.type === 'contact' || node.type === 'coil') {
            const expectedType = 'bool'
            const actualType = selectedVariable.type.value.toLowerCase()

            if (actualType !== expectedType) {
              updateNode({
                editorName: flow.name,
                rungId: rung.id,
                nodeId: node.id,
                node: {
                  ...node,
                  data: {
                    ...node.data,
                    variable: { ...selectedVariable, id: `broken-${node.id}` },
                    wrongVariable: true,
                  },
                },
              })
              return
            }
          }

          applyVariableToNode(selectedVariable, node.id, flow.name, ladderFlows, updateNode)
        })
      })
    })
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const syncNodesWithVariablesFBD = (
    newVars: PLCVariable[],
    fbdFlows: FBDFlowState['fbdFlows'],
    updateNode: FBDFlowActions['updateNode'],
  ) => {
    fbdFlows.forEach((flow) => {
      flow.rung.nodes.forEach((node) => {
        const nodeVar = (node.data as { variable?: PLCVariable }).variable

        if (!nodeVar || !nodeVar.name) {
          return
        }

        const selectedVariable = newVars.find((variable) => variable.name.toLowerCase() === nodeVar.name.toLowerCase())

        if (!selectedVariable) {
          updateNode({
            editorName: flow.name,
            nodeId: node.id,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: { ...nodeVar, id: `broken-${node.id}` },
                wrongVariable: true,
              },
            },
          })
          return
        }

        if (node.type === 'contact' || node.type === 'coil') {
          const expectedType = 'bool'
          const actualType = selectedVariable.type.value.toLowerCase()

          if (actualType !== expectedType) {
            updateNode({
              editorName: flow.name,
              nodeId: node.id,
              node: {
                ...node,
                data: {
                  ...node.data,
                  variable: { ...selectedVariable, id: `broken-${node.id}` },
                  wrongVariable: true,
                },
              },
            })
            return
          }
        }

        applyVariableToNodeFBD(selectedVariable, node.id, flow.name, fbdFlows, updateNode)
      })
    })
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const commitCode = async (): Promise<boolean> => {
    try {
      addSnapshot(editor.meta.name)

      const language = 'language' in editor.meta ? editor.meta.language : undefined

      if (!language) return false

      const newVariables = parseIecStringToVariables(editorCode, pous, dataTypes, libraries)

      const renamedPairs = tableData.flatMap((previousVariable) => {
        const variableStillExists = newVariables.some(
          (newVariable) => newVariable.name.toLowerCase() === previousVariable.name.toLowerCase(),
        )

        if (variableStillExists) {
          return []
        }

        const renameCandidate = newVariables.find(
          (newVariable) =>
            newVariable.type.value.toLowerCase() === previousVariable.type.value.toLowerCase() &&
            !tableData.some(
              (existingVariable) => existingVariable.name.toLowerCase() === newVariable.name.toLowerCase(),
            ),
        )

        return renameCandidate
          ? [
              {
                oldName: previousVariable.name,
                newName: renameCandidate.name,
                type: previousVariable.type.value.toLowerCase(),
              },
            ]
          : []
      })

      let shouldPropagate = true

      if (renamedPairs.length && language === 'ld') {
        const blockUsesOldName = ladderFlows.some((flow) =>
          flow.rungs.some((rung) =>
            rung.nodes.some((node) => {
              const varName = (node.data as { variable?: PLCVariable }).variable?.name || ''
              return renamedPairs.some((p) => p.oldName.toLowerCase() === varName.toLowerCase())
            }),
          ),
        )

        if (blockUsesOldName) shouldPropagate = await askRenameBlocks()
      }

      if (renamedPairs.length && language === 'fbd') {
        const blockUsesOldName = fbdFlows.some((flow) =>
          flow.rung.nodes.some((node) => {
            const varName = (node.data as { variable?: PLCVariable }).variable?.name || ''
            return renamedPairs.some((p) => p.oldName.toLowerCase() === varName.toLowerCase())
          }),
        )

        if (blockUsesOldName) shouldPropagate = await askRenameBlocks()
      }

      const response = setPouVariables({
        pouName: pou?.data?.name ?? '',
        variables: newVariables as PLCVariable[],
      })

      if (!response.ok) {
        throw new Error(response.title + (response.message ? `: ${response.message}` : ''))
      }

      if (language === 'ld') {
        syncNodesWithVariables(newVariables as PLCVariable[], ladderFlows, updateNode)
      }

      if (language === 'fbd') {
        syncNodesWithVariablesFBD(newVariables as PLCVariable[], fbdFlows, updateFBDNode)
      }

      if (shouldPropagate) {
        if (language === 'fbd') {
          relinkVariablesByNameFBD(renamedPairs, newVariables as PLCVariable[], fbdFlows, updateFBDNode, true)
        }

        if (language === 'ld') {
          relinkVariablesByName(renamedPairs, newVariables as PLCVariable[], ladderFlows, updateNode, true)
        }
      } else {
        relinkVariablesByName(renamedPairs, newVariables as PLCVariable[], ladderFlows, updateNode, false)
        relinkVariablesByNameFBD(renamedPairs, newVariables as PLCVariable[], fbdFlows, updateFBDNode, false)
        unlinkRenamedVariablesByName(renamedPairs, ladderFlows, updateNode)
        unlinkRenamedVariablesByNameFBD(renamedPairs, fbdFlows, updateFBDNode)
      }

      toast({ title: 'Variables updated', description: 'Changes applied successfully.' })
      setParseError(null)
      handleFileAndWorkspaceSavedState(editor.meta.name)

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected syntax error.'
      setParseError(message)
      toast({ title: 'Syntax error', description: message, variant: 'fail' })
      return false
    }
  }

  return (
    <>
      {confirmRenameBlocksOpen && (
        <Modal open>
          <ModalContent
            className='flex h-48 w-[496px] select-none flex-col justify-between gap-2 rounded-lg p-8'
            onClose={() => {
              confirmRenameBlocksResolveRef.current?.(false)
              setConfirmRenameBlocksOpen(false)
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
                  confirmRenameBlocksResolveRef.current?.(false)
                  setConfirmRenameBlocksOpen(false)
                }}
                className='h-8 w-full rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
              >
                No, keep references unchanged
              </button>
              <button
                onClick={() => {
                  confirmRenameBlocksResolveRef.current?.(true)
                  setConfirmRenameBlocksOpen(false)
                }}
                className='h-8 w-full rounded bg-brand px-3 py-1 text-xs text-white'
              >
                Yes, rename references
              </button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      <div aria-label='Variables editor container' className='flex h-full w-full flex-1 flex-col gap-4 overflow-auto'>
        <div aria-label='Variables editor actions' className='relative flex h-8 w-full gap-4'>
          {editorVariables.display === 'table' && (
            <div aria-label='Variables editor table actions container' className='flex h-full w-full select-none gap-4'>
              {editor.type === 'plc-textual' && editor.meta.pouType === 'function' && (
                <div className='flex h-full max-w-lg flex-1 items-center gap-2'>
                  <label
                    htmlFor='return type'
                    className='w-fit text-nowrap text-xs font-medium text-neutral-1000 dark:text-neutral-300'
                  >
                    Return type :
                  </label>
                  <Select value={returnType} onValueChange={handleReturnTypeChange}>
                    <SelectTrigger
                      id='class-filter'
                      placeholder={returnType}
                      withIndicator
                      className='group flex h-full w-full items-center justify-between rounded-lg border border-neutral-500 px-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-neutral-850 dark:text-neutral-300'
                    />
                    <SelectContent
                      position='popper'
                      sideOffset={3}
                      align='center'
                      className='box h-fit min-w-44 overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                    >
                      {returnTypeOptions.map((filter) => (
                        <SelectItem
                          key={filter}
                          value={filter}
                          className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                        >
                          <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                            {filter}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div
                id='Pou documentation'
                aria-label='Variables editor table description container'
                className='flex h-full max-w-lg flex-1 items-center  gap-2'
              >
                <label
                  htmlFor='description'
                  className='w-fit text-nowrap text-xs font-medium text-neutral-1000 dark:text-neutral-300'
                >
                  Description :
                </label>
                <InputWithRef
                  id='description'
                  onBlur={handleDescriptionChange}
                  value={pouDescription}
                  onChange={handleDescriptionValueChange}
                  className='h-full w-full rounded-lg border border-neutral-500 bg-inherit p-2 font-caption text-cp-sm font-normal text-neutral-850 focus:border-brand focus:outline-none dark:border-neutral-850 dark:text-neutral-300'
                />
              </div>

              <div
                aria-label='Variables editor table class filter container'
                className='flex h-full max-w-lg flex-1 items-center  gap-2'
              >
                <label
                  htmlFor='class-filter'
                  className='w-fit text-nowrap text-xs font-medium text-neutral-1000 dark:text-neutral-300'
                >
                  Class Filter :
                </label>
                <Select value={editorVariables.classFilter} onValueChange={handleFilterChange}>
                  <SelectTrigger
                    id='class-filter'
                    placeholder={editorVariables.classFilter}
                    withIndicator
                    className='group flex h-full w-full items-center justify-between rounded-lg border border-neutral-500 px-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-neutral-850 dark:text-neutral-300'
                  />
                  <SelectContent
                    position='popper'
                    sideOffset={3}
                    align='center'
                    className='box h-fit w-40 overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                  >
                    {FilterOptions.map((filter) => (
                      <SelectItem
                        key={filter}
                        value={filter}
                        className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                      >
                        <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                          {filter}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className='hidden justify-end xl:flex'>
            {editorVariables.display === 'table' && (
              <div
                aria-label='Variables editor table actions container'
                className='mr-2 flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
              >
                <TableActions
                  actions={[
                    {
                      ariaLabel: 'Add table row button',
                      onClick: handleCreateVariable,
                      disabled: isDebuggerVisible,
                      icon: <PlusIcon className='!stroke-brand' />,
                      id: 'add-variable-button',
                    },
                    {
                      ariaLabel: 'Remove table row button',
                      onClick: handleRemoveVariable,
                      disabled: isDebuggerVisible || parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED,
                      icon: <MinusIcon />,
                      id: 'remove-variable-button',
                    },
                    {
                      ariaLabel: 'Move table row up button',
                      onClick: () => handleRearrangeVariables(-1),
                      disabled:
                        isDebuggerVisible ||
                        parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                        parseInt(editorVariables.selectedRow) === 0,
                      icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                      id: 'move-variable-up-button',
                    },
                    {
                      ariaLabel: 'Move table row down button',
                      onClick: () => handleRearrangeVariables(1),
                      disabled:
                        isDebuggerVisible ||
                        parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                        parseInt(editorVariables.selectedRow) === tableData.length - 1,
                      icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                      id: 'move-variable-down-button',
                    },
                  ]}
                />
              </div>
            )}

            <div
              aria-label='Variables visualization switch container'
              className={cn('flex h-fit w-fit items-center justify-center rounded-md', {
                'absolute right-0': editorVariables.display === 'code',
              })}
            >
              <TableIcon
                aria-label='Variables table visualization'
                onClick={() => {
                  void handleVisualizationTypeChange('table')
                }}
                size='md'
                currentVisible={editorVariables.display === 'table'}
                className={cn(
                  editorVariables.display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
                  'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
                )}
              />
              <CodeIcon
                aria-label='Variables code visualization'
                onClick={() => {
                  void handleVisualizationTypeChange('code')
                }}
                size='md'
                currentVisible={editorVariables.display === 'code'}
                className={cn(
                  editorVariables.display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
                  'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
                )}
              />
            </div>
          </div>
        </div>

        <div className='flex w-full justify-end gap-4 xl:hidden'>
          {editorVariables.display === 'table' && (
            <div
              aria-label='Variables editor table actions container'
              className='mr-2 flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
            >
              <TableActions
                actions={[
                  {
                    ariaLabel: 'Add table row button',
                    onClick: handleCreateVariable,
                    icon: <PlusIcon className='!stroke-brand' />,
                    id: 'add-variable-button',
                  },
                  {
                    ariaLabel: 'Remove table row button',
                    onClick: handleRemoveVariable,
                    disabled: parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED,
                    icon: <MinusIcon />,
                    id: 'remove-variable-button',
                  },
                  {
                    ariaLabel: 'Move table row up button',
                    onClick: () => handleRearrangeVariables(-1),
                    disabled:
                      parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                      parseInt(editorVariables.selectedRow) === 0,
                    icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                    id: 'move-variable-up-button',
                  },
                  {
                    ariaLabel: 'Move table row down button',
                    onClick: () => handleRearrangeVariables(1),
                    disabled:
                      parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                      parseInt(editorVariables.selectedRow) === tableData.length - 1,
                    icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                    id: 'move-variable-down-button',
                  },
                ]}
              />
            </div>
          )}

          <div
            aria-label='Variables visualization switch container'
            className={cn('flex h-fit w-fit items-center justify-center rounded-md', {
              'absolute right-0 top-0': editorVariables.display === 'code',
            })}
          >
            <TableIcon
              aria-label='Variables table visualization'
              onClick={() => {
                void handleVisualizationTypeChange('table')
              }}
              size='md'
              currentVisible={editorVariables.display === 'table'}
              className={cn(
                editorVariables.display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
                'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
              )}
            />
            {/** TODO: Need to be implemented */}
            <CodeIcon
              aria-label='Variables code visualization'
              onClick={() => {
                void handleVisualizationTypeChange('code')
              }}
              size='md'
              currentVisible={editorVariables.display === 'code'}
              className={cn(
                editorVariables.display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
                'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
              )}
            />
          </div>
        </div>

        {editorVariables.display === 'table' && (
          <div
            aria-label='Variables editor table container'
            className='h-full overflow-x-auto overflow-y-auto lg:overflow-x-hidden'
            style={{ scrollbarGutter: 'stable' }}
          >
            <VariablesTable
              tableData={tableData}
              filterValue={editorVariables.classFilter.toLowerCase()}
              columnFilters={columnFilters}
              setColumnFilters={setColumnFilters}
              selectedRow={parseInt(editorVariables.selectedRow)}
              handleRowClick={handleRowClick}
            />
          </div>
        )}

        {editorVariables.display === 'code' && (
          <div
            aria-label='Variables editor code container'
            className='mb-1 h-full overflow-y-auto'
            style={{ scrollbarGutter: 'stable' }}
          >
            <VariablesCodeEditor code={editorCode} onCodeChange={setEditorCode} shouldUseDarkMode={shouldUseDarkMode} />

            {parseError && <p className='mt-2 text-xs text-red-500'>Error: {parseError}</p>}
          </div>
        )}
      </div>
    </>
  )
}

export { VariablesEditor }
