import { ColumnFiltersState } from '@tanstack/react-table'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PLCVariable } from '../../../../middleware/shared/ports/types'
import { CodeIcon } from '../../../assets/icons/interface/CodeIcon'
import { MinusIcon } from '../../../assets/icons/interface/Minus'
import { PlusIcon } from '../../../assets/icons/interface/Plus'
import { StickArrowIcon } from '../../../assets/icons/interface/StickArrow'
import { TableIcon } from '../../../assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '../../../store'
import type { VariablesTable as VariablesTableType } from '../../../store/slices/editor'
import { selectEditorForPou } from '../../../store/slices/editor/utils'
import type { FBDFlowActions, FBDFlowState } from '../../../store/slices/fbd'
import type { LadderFlowActions, LadderFlowState } from '../../../store/slices/ladder'
import { TypeChangeValidationResult, validateTypeChange } from '../../../store/slices/project/validation/type-change'
import { cn } from '../../../utils/cn'
import { parseIecStringToVariables } from '../../../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../../../utils/generate-iec-variables-to-string'
import {
  syncNodesWithVariables as syncNodesWithVariablesUtil,
  syncNodesWithVariablesFBD as syncNodesWithVariablesFBDUtil,
} from '../../../utils/graphical/sync-nodes-with-variables'
import { baseTypes } from '../../../utils/plc-constants/types'
import {
  findAllReferencesToVariable,
  propagateVariableRename,
  type ReferenceImpactAnalysis,
} from '../../../utils/variable-references'
import { InputWithRef } from '../../_atoms/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms/select'
import TableActions from '../../_atoms/table-actions'
import { toast } from '../../_features/[app]/toast/use-toast'
import { RenameImpactModal } from '../../_molecules/rename-impact-modal'
import { TypeChangeModal } from '../../_molecules/type-change-modal'
import { VariablesTable } from '../../_molecules/variables-table'
import { VariablesCodeEditor } from '../variables-code-editor'

interface VariablesEditorProps {
  /**
   * POU name this VariablesEditor instance is bound to.  When omitted
   * (legacy callers) the editor falls back to whichever POU is
   * currently active in the store.  With multi-mount, every open POU
   * has its own VariablesEditor instance with `name` set explicitly,
   * so each operates on its own model regardless of which tab is
   * visible.
   */
  name?: string
  /**
   * Whether this instance corresponds to the currently active tab.
   * Currently unused — every effect in this component is naturally
   * scoped to its own POU via `propName`, so hidden instances don't
   * react to other POUs' state changes.  Kept on the prop contract
   * so callers in workspace-screen.tsx pass it consistently with
   * the other multi-mounted editors and so future gating (e.g. of
   * expensive memos) has a hook to attach to without an API break.
   */
  isActive?: boolean
}

const VariablesEditor = ({ name: propName, isActive: _isActive = true }: VariablesEditorProps = {}) => {
  const ROWS_NOT_SELECTED = -1
  // Multi-mount support: every open POU's VariablesEditor reads ITS
  // OWN model via the shared `selectEditorForPou` helper.  This is
  // the same selector the graphical editors use through
  // `useBoundEditorModel()` — kept centralised so the active-editor
  // preference + hidden-snapshot fallback can't drift between the
  // textual and graphical multi-mount paths.
  const editor = useOpenPLCStore((s) => selectEditorForPou(s, propName))
  const {
    ladderFlows,
    ladderFlowActions: { updateNode },
    fbdFlows,
    fbdFlowActions: { updateNode: updateFBDNode },
    workspace: {
      systemConfigs: { shouldUseDarkMode },
      isDebuggerVisible,
    },
    workspaceActions: { removeDebugVariable },
    project: {
      data: { pous, dataTypes },
    },
    libraries,
    editorActions: { updateModelVariables, updateModelVariablesForName },
    projectActions: {
      createVariable,
      deleteVariable,
      rearrangeVariables,
      updatePouDocumentation,
      updatePouReturnType,
      clearPouVariablesText,
      setPouVariables,
      updatePou,
      updateVariable,
    },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const {
    project: {
      data: { pous: snapshotPous, configurations },
    },
    snapshotActions: { pushToHistory: rawPushToHistory },
  } = useOpenPLCStore()

  const pushToHistory = useCallback(
    (pouName: string) => {
      const pou = snapshotPous.find((p) => p.name === pouName)
      if (!pou) return
      rawPushToHistory(pouName, {
        variables: pou.interface?.variables ?? [],
        body: pou.body.value,
        globalVariables: configurations.resource.globalVariables,
      })
    },
    [snapshotPous, configurations.resource.globalVariables, rawPushToHistory],
  )

  /**
   * Table data and column filters states to keep track of the table data and column filters
   */
  const [tableData, setTableData] = useState<PLCVariable[]>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [returnType, setReturnType] = useState('BOOL')
  const [returnTypeOptions, setReturnTypeOptions] = useState<string[]>([])
  const [editorCode, setEditorCode] = useState(() => {
    if (
      (editor.type === 'plc-textual' || editor.type === 'plc-graphical') &&
      editor.variable.display === 'code' &&
      typeof editor.variable.code === 'string'
    ) {
      return editor.variable.code
    }
    return generateIecVariablesToString(tableData)
  })
  const [parseError, setParseError] = useState<string | null>(null)
  const [pouDescription, setPouDescription] = useState<string>('')
  const [confirmRenameBlocksOpen, setConfirmRenameBlocksOpen] = useState(false)
  const [renameImpactData, setRenameImpactData] = useState<{
    oldName: string
    newName: string
    impact: ReferenceImpactAnalysis
  } | null>(null)
  const confirmRenameBlocksResolveRef = useRef<(v: boolean) => void>()
  const [typeChangeModalOpen, setTypeChangeModalOpen] = useState(false)
  const [typeChangeData, setTypeChangeData] = useState<{
    variableName: string
    oldType: PLCVariable['type']
    newType: PLCVariable['type']
    validation: TypeChangeValidationResult
  } | null>(null)
  const typeChangeResolveRef = useRef<(v: boolean) => void>()

  /**
   * Editor name state to keep track of the editor name
   * Other states to keep track of the editor's variables and display at the screen
   */
  const FilterOptions = ['All', 'Local', 'Input', 'Output', 'InOut', 'External', 'Temp'] as const
  type FilterOptionsType = (typeof FilterOptions)[number]
  const [editorVariables, setEditorVariables] = useState<VariablesTableType>(() => {
    if (editor.type === 'plc-textual' || editor.type === 'plc-graphical') {
      if (editor.variable.display === 'code') {
        return { display: 'code' }
      }
    }
    return {
      display: 'table',
      selectedRow: ROWS_NOT_SELECTED.toString(),
      classFilter: 'All',
      description: '',
    }
  })

  const pou = pous.find((p) => p.name === editor.meta.name)
  useEffect(() => {
    const data = pou?.documentation
    if (data) setPouDescription(data)
    return () => {
      setPouDescription('')
    }
  }, [editor, pou?.documentation])

  /**
   * Update the table data and the editor's variables when the editor or the pous change
   */
  useEffect(() => {
    if (pou) {
      setTableData(pou.interface?.variables ?? [])
      if (pou.pouType === 'function') {
        setReturnType(pou.interface?.returnType ?? 'BOOL')
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
    if (editorVariables.display !== 'code') {
      setEditorCode(generateIecVariablesToString(tableData))
    }
  }, [tableData, editorVariables.display])

  // Sync local view state from this instance's own model when the
  // POU is renamed or its display mode toggles (table ↔ code).  Each
  // VariablesEditor is bound to a specific POU via `propName`, so this
  // effect only re-derives for changes to THIS POU's model, not
  // whichever happens to be active.  Driven off `editor.meta.name` so
  // unrelated mutations (cursorPosition, variable list edits) don't
  // re-fire it.
  const editorVariableState = editor.type === 'plc-textual' || editor.type === 'plc-graphical' ? editor.variable : null
  const editorVariableDisplay = editorVariableState?.display

  useEffect(() => {
    if (!editorVariableState) return
    if (editorVariableState.display === 'code') {
      setEditorVariables({ display: 'code' })
      const code = editorVariableState.code
      const targetPou = pous.find((p) => p.name === editor.meta.name)
      // Prefer the model's own stored code; fall back to a fresh
      // generation from the new POU's variables so the panel shows
      // *its* declarations, not whatever the previous POU last had.
      setEditorCode(
        typeof code === 'string' && code.length > 0
          ? code
          : generateIecVariablesToString(targetPou?.interface?.variables ?? []),
      )
    } else {
      setEditorVariables({
        display: 'table',
        selectedRow: editorVariableState.selectedRow ?? ROWS_NOT_SELECTED.toString(),
        classFilter: editorVariableState.classFilter ?? 'All',
        description: editorVariableState.description ?? '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.meta.name, editorVariableDisplay])

  const containerRef = useRef<HTMLDivElement>(null)
  const latestCodeRef = useRef(editorCode)
  const latestDisplayRef = useRef(editorVariables.display)
  const latestEditorNameRef = useRef(editor.meta.name)
  const lastParsedCodeRef = useRef(editorCode)
  const isParsingRef = useRef(false)
  const commitCodeRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))

  useEffect(() => {
    latestCodeRef.current = editorCode
    latestDisplayRef.current = editorVariables.display
    latestEditorNameRef.current = editor.meta.name
  }, [editorCode, editorVariables.display, editor.meta.name])

  useEffect(() => {
    lastParsedCodeRef.current = editorCode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.meta.name])

  useEffect(() => {
    if (editorVariables.display === 'code') {
      updateModelVariablesForName(latestEditorNameRef.current, {
        display: 'code',
        code: editorCode,
      })
    }
  }, [editorCode, editorVariables.display, updateModelVariablesForName])

  useEffect(() => {
    return () => {
      if (latestDisplayRef.current === 'code') {
        updateModelVariablesForName(latestEditorNameRef.current, {
          display: 'code',
          code: latestCodeRef.current,
        })
      }
    }
  }, [updateModelVariablesForName])

  useEffect(() => {
    if (editorVariables.display !== 'code') return

    const tryCommit = () => {
      if (confirmRenameBlocksOpen || typeChangeModalOpen) return
      if (isParsingRef.current) return
      if (editorCode === lastParsedCodeRef.current) return

      isParsingRef.current = true

      void commitCodeRef
        .current()
        .then((ok) => {
          if (ok) {
            lastParsedCodeRef.current = editorCode
          }
        })
        .finally(() => {
          isParsingRef.current = false
        })
    }

    const onDocMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (containerRef.current.contains(e.target as Node)) return
      tryCommit()
    }

    // Commit on focus leaving the variables editor (covers keyboard navigation,
    // Tab, shortcuts — anything that moves focus without a mousedown).
    const onFocusOut = (e: FocusEvent) => {
      if (!containerRef.current) return
      const newTarget = e.relatedTarget as Node | null
      if (newTarget && containerRef.current.contains(newTarget)) return
      tryCommit()
    }

    const container = containerRef.current
    document.addEventListener('mousedown', onDocMouseDown, true)
    container?.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      container?.removeEventListener('focusout', onFocusOut)
    }
  }, [editorVariables.display, editorCode, confirmRenameBlocksOpen, typeChangeModalOpen])

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
      } else if (editor.variable.display === 'code') {
        const code = editor.variable.code
        setEditorVariables({
          display: editor.variable.display,
        })
        if (typeof code === 'string') {
          setEditorCode(code)
          // lastParsedCodeRef is only reset when POU changes (via [editor.meta.name] effect)
        }
      }
  }, [editor])

  const handleVisualizationTypeChange = async (value: 'code' | 'table') => {
    if (editorVariables.display === 'code' && value === 'table') {
      const success = await commitCode()
      if (!success) return
    }

    updateModelVariables({
      display: value,
      code: value === 'code' ? editorCode : undefined,
    })
  }

  const handleRearrangeVariables = (index: number, row?: number) => {
    if (editorVariables.display === 'code') return

    pushToHistory(editor.meta.name)

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

    pushToHistory(editor.meta.name)

    const matchedPou = pous.find((p) => p.name === editor.meta.name)
    const variables = matchedPou?.interface?.variables ?? []
    const selectedRow = parseInt(editorVariables.selectedRow)

    const language = 'language' in editor.meta ? editor.meta.language : null
    const defaultClass: PLCVariable['class'] = language === 'python' || language === 'cpp' ? 'input' : 'local'

    if (variables.length === 0) {
      createVariable({
        scope: 'local',
        associatedPou: editor.meta.name,
        data: {
          name: 'LocalVar',
          class: defaultClass,
          type: { definition: 'base-type', value: 'DINT' },
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

    // Single-field location: only carry a MANUAL literal address forward
    // (createVariable auto-increments it for a fresh contiguous row). An
    // alias binding must NOT be duplicated onto the new row — that would
    // point two variables at the same address and fail compile — so an
    // alias-name location starts empty (unlocated) instead.
    const newVarData = {
      ...variable,
      location: variable.location.startsWith('%') ? variable.location : '',
      class: defaultClass,
      type:
        variable.type.definition === 'derived'
          ? { definition: 'base-type' as const, value: 'DINT' as const }
          : variable.type,
      documentation: '',
    }

    if (selectedRow === ROWS_NOT_SELECTED) {
      createVariable({
        scope: 'local',
        associatedPou: editor.meta.name,
        data: newVarData,
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
      data: newVarData,
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

    pushToHistory(editor.meta.name)

    const selectedRow = parseInt(editorVariables.selectedRow)
    const deletePou = pous.find((p) => p.name === editor.meta.name)
    const variables = deletePou?.interface?.variables ?? []
    const variableToDelete = variables[selectedRow]

    if (variableToDelete) {
      const compositeKey = `${editor.meta.name}:${variableToDelete.name}`
      removeDebugVariable(compositeKey)
    }

    deleteVariable({ scope: 'local', associatedPou: editor.meta.name, rowId: selectedRow })

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

  const handleReturnTypeChange = (value: string) => {
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

  const askTypeChange = () =>
    new Promise<boolean>((resolve) => {
      typeChangeResolveRef.current = resolve
      setTypeChangeModalOpen(true)
    })

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

  const _syncNodesWithVariables = (
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

  const _syncNodesWithVariablesFBD = (
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
      pushToHistory(editor.meta.name)

      let language: string | undefined
      if (editor.type === 'plc-graphical') {
        language = editor.graphical.language
      } else if (editor.type === 'plc-textual') {
        language = editor.meta.language
      }

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
                oldVariable: previousVariable,
              },
            ]
          : []
      })

      const typeChangedPairs = tableData.flatMap((previousVariable) => {
        const matchingNewVariable = newVariables.find(
          (newVariable) => newVariable.name.toLowerCase() === previousVariable.name.toLowerCase(),
        )

        if (
          !matchingNewVariable ||
          matchingNewVariable.type.value.toLowerCase() === previousVariable.type.value.toLowerCase()
        ) {
          return []
        }

        return [
          {
            name: previousVariable.name,
            oldVariable: previousVariable,
            newVariable: matchingNewVariable,
          },
        ]
      })

      const renamedPairsToPropagate: typeof renamedPairs = []
      const typeChangedPairsToApply: typeof typeChangedPairs = []

      for (const pair of renamedPairs) {
        const impact = findAllReferencesToVariable(
          pair.oldName,
          pair.oldVariable.type,
          editor.meta.name,
          pous,
          ladderFlows,
          fbdFlows,
          'local',
        )

        if (impact.totalReferences > 0) {
          setRenameImpactData({
            oldName: pair.oldName,
            newName: pair.newName,
            impact,
          })
          const shouldPropagateRename = await askRenameBlocks()
          setRenameImpactData(null)

          if (shouldPropagateRename) {
            renamedPairsToPropagate.push(pair)
          }
        }
      }

      for (const pair of typeChangedPairs) {
        const validation = validateTypeChange(
          pair.name,
          pair.oldVariable.type,
          pair.newVariable.type,
          ladderFlows,
          fbdFlows,
        )

        if (validation.affectedNodes.length > 0 || validation.warnings.length > 0) {
          setTypeChangeData({
            variableName: pair.name,
            oldType: pair.oldVariable.type,
            newType: pair.newVariable.type,
            validation,
          })
          const shouldApply = await askTypeChange()
          setTypeChangeData(null)

          if (!shouldApply) {
            continue
          }
        }

        typeChangedPairsToApply.push(pair)
      }

      // Build a map of debug flags from existing variables
      const debugByName = new Map(tableData.map((v) => [v.name.toLowerCase(), v.debug ?? false]))

      // Preserve debug flags for renamed variables
      for (const pair of renamedPairs) {
        debugByName.set(pair.newName.toLowerCase(), pair.oldVariable.debug ?? false)
      }

      const finalVariables = newVariables.map((newVar) => {
        const debug = debugByName.get(newVar.name.toLowerCase()) ?? false

        const typeChangePair = typeChangedPairs.find((pair) => pair.name.toLowerCase() === newVar.name.toLowerCase())

        if (typeChangePair) {
          const wasApplied = typeChangedPairsToApply.some(
            (appliedPair) => appliedPair.name.toLowerCase() === newVar.name.toLowerCase(),
          )

          if (!wasApplied) {
            return { ...newVar, type: typeChangePair.oldVariable.type, debug }
          }
        }

        return { ...newVar, debug }
      })

      const response = setPouVariables({
        pouName: pou?.name ?? '',
        variables: finalVariables,
      })

      if (!response.ok) {
        throw new Error(response.title + (response.message ? `: ${response.message}` : ''))
      }

      const {
        project: {
          data: { pous: freshPous },
        },
        ladderFlows: freshLadderFlows,
        fbdFlows: freshFBDFlows,
      } = useOpenPLCStore.getState()

      const freshPou = freshPous.find((p) => p.name === editor.meta.name)
      const freshVariables = freshPou?.interface?.variables ?? []

      if (language === 'ld') {
        syncNodesWithVariablesUtil(freshVariables, freshLadderFlows, updateNode)
      }

      if (language === 'fbd') {
        syncNodesWithVariablesFBDUtil(freshVariables, freshFBDFlows, updateFBDNode)
      }

      for (const pair of renamedPairsToPropagate) {
        const impact = findAllReferencesToVariable(
          pair.oldName,
          pair.oldVariable.type,
          editor.meta.name,
          freshPous,
          freshLadderFlows,
          freshFBDFlows,
          'local',
        )

        if (impact.totalReferences > 0) {
          propagateVariableRename(
            pair.oldName,
            pair.newName,
            impact.references,
            freshLadderFlows,
            freshFBDFlows,
            freshPous,
            { updateNode },
            { updateNode: updateFBDNode },
            { updatePou, updateVariable },
            'local',
          )
        }
      }

      setParseError(null)
      handleFileAndWorkspaceSavedState(editor.meta.name)

      if (freshPou && 'variablesText' in freshPou) {
        clearPouVariablesText(editor.meta.name)
      }

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected syntax error.'
      setParseError(message)
      toast({ title: 'Syntax error', description: message, variant: 'fail' })
      return false
    }
  }

  useEffect(() => {
    commitCodeRef.current = commitCode
  }, [commitCode])

  // Memoise so the `<VariablesCodeEditor cursorPosition>` prop holds a
  // stable reference when the underlying values don't change.  Without
  // this, the child's cursor-jump effect — keyed on `cursorPosition`
  // identity — re-fires on every parent render (one per keystroke,
  // because `setEditorCode` triggers it), re-selects the navigation
  // line, and the next character typed replaces that selection.
  const codeEditorCursorPosition = useMemo(
    () =>
      editor.cursorPosition
        ? {
            lineNumber: editor.cursorPosition.lineNumber,
            column: editor.cursorPosition.column,
            target: editor.cursorPosition.target,
          }
        : undefined,
    [editor.cursorPosition?.lineNumber, editor.cursorPosition?.column, editor.cursorPosition?.target],
  )

  // Go to Definition on a variable lands here with `target='variables'`
  // even when the panel is currently in table mode — force the switch
  // so the user actually sees the highlight.  Idempotent when already
  // in code mode.
  useEffect(() => {
    if (editor.cursorPosition?.target !== 'variables') return
    if (editorVariables.display === 'code') return
    updateModelVariables({ display: 'code', code: editorCode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.cursorPosition?.target, editor.cursorPosition?.lineNumber, editor.cursorPosition?.column])

  return (
    <>
      {confirmRenameBlocksOpen && renameImpactData && (
        <RenameImpactModal
          open={confirmRenameBlocksOpen}
          oldName={renameImpactData.oldName}
          newName={renameImpactData.newName}
          impact={renameImpactData.impact}
          onConfirm={() => {
            confirmRenameBlocksResolveRef.current?.(true)
            setConfirmRenameBlocksOpen(false)
          }}
          onCancel={() => {
            confirmRenameBlocksResolveRef.current?.(false)
            setConfirmRenameBlocksOpen(false)
          }}
        />
      )}

      {typeChangeModalOpen && typeChangeData && (
        <TypeChangeModal
          open={typeChangeModalOpen}
          variableName={typeChangeData.variableName}
          oldType={typeChangeData.oldType}
          newType={typeChangeData.newType}
          validation={typeChangeData.validation}
          onConfirm={() => {
            typeChangeResolveRef.current?.(true)
            setTypeChangeModalOpen(false)
          }}
          onCancel={() => {
            typeChangeResolveRef.current?.(false)
            setTypeChangeModalOpen(false)
          }}
        />
      )}

      <div
        ref={containerRef}
        aria-label='Variables editor container'
        className='flex h-full w-full flex-1 flex-col gap-4 overflow-auto'
      >
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
            <VariablesCodeEditor
              code={editorCode}
              onCodeChange={setEditorCode}
              shouldUseDarkMode={shouldUseDarkMode}
              cursorPosition={codeEditorCursorPosition}
              pouName={editor.meta.name}
            />

            {parseError && <p className='mt-2 text-xs text-red-500'>Error: {parseError}</p>}
          </div>
        )}
      </div>
    </>
  )
}

export { VariablesEditor }
