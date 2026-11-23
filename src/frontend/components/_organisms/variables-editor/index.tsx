import * as Popover from '@radix-ui/react-popover'
import { ColumnFiltersState } from '@tanstack/react-table'
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { PLCVariable } from '../../../../middleware/shared/ports/types'
import { useIsEditingLocked } from '../../../hooks/use-editing-lock'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../../../store'
import type { VariablesTable as VariablesTableType } from '../../../store/slices/editor'
import { selectEditorForPou } from '../../../store/slices/editor/utils'
import type { FBDFlowActions, FBDFlowState } from '../../../store/slices/fbd'
import type { LadderFlowActions, LadderFlowState } from '../../../store/slices/ladder'
import { TypeChangeValidationResult, validateTypeChange } from '../../../store/slices/project/validation/type-change'
import { validateVariableSet } from '../../../store/slices/project/validation/variables'
import { cn } from '../../../utils/cn'
import { buildTypeContext, parseIecStringToVariables } from '../../../utils/generate-iec-string-to-variables'
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
import { applyVariablesToText } from '../../../utils/variable-text-edits'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms/select'
import { toast } from '../../_features/[app]/toast/use-toast'
import { RungMenu, type RungMenuItem } from '../../_molecules/graphical-editor/ladder/rung/rung-menu'
import { RenameImpactModal } from '../../_molecules/rename-impact-modal'
import { TypeChangeModal } from '../../_molecules/type-change-modal'
import { VariablesTable } from '../../_molecules/variables-table'
import { EDITOR_ACTIONS_SLOT_ID } from '../navigation'
import { VariablesCodeEditor } from '../variables-code-editor'

/**
 * The declaration text to put in the code view.
 *
 * The POU's own text when it has one, because that text is the source of
 * truth (DOPE-650) and is the only thing carrying the user's comments, blank
 * lines and alignment. Serialising the model is the fallback for a POU that
 * has never had text — one created in memory this session.
 *
 * Every buffer-filling path goes through here. They used to call
 * `generateIecVariablesToString` directly, which meant simply toggling to code
 * view replaced the user's declarations with a canonical re-rendering of the
 * table and dropped every comment, even though the text itself had survived
 * the load intact.
 */
const declarationTextFor = (pou: PLCPou | undefined, variables: PLCVariable[]): string =>
  pou?.variablesText ?? generateIecVariablesToString(variables)

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

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/** The slot at the right of the tab bar, once the navigation bar has rendered it. */
function useEditorActionsSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById(EDITOR_ACTIONS_SLOT_ID)), [])
  return slot
}

type ActionTileProps = ComponentPropsWithoutRef<'button'> & {
  label: string
  path: string
  on?: boolean
}

/** A tab-bar action in the style of the Table/Code switch: a filled tile, brand blue with a white icon when on. */
const ActionTile = forwardRef<HTMLButtonElement, ActionTileProps>(
  ({ label, path, on = false, className, ...rest }, ref) => (
    <button
      ref={ref}
      type='button'
      aria-label={label}
      aria-pressed={on}
      className={cn(
        'flex hover:cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      <svg
        viewBox='0 0 30 28'
        fill='none'
        className={cn(
          'h-8 w-8 transition-colors ease-in-out',
          on ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
          className,
        )}
      >
        <rect width='30' height='28' fill='inherit' />
        <path
          d={path}
          stroke={on ? 'white' : '#C8D0D9'}
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    </button>
  ),
)
ActionTile.displayName = 'ActionTile'

const POU_TYPE_LABEL: Record<string, string> = {
  program: 'Program',
  function: 'Function',
  'function-block': 'Function block',
}

const VariablesEditor = ({ name: propName, isActive: _isActive = true }: VariablesEditorProps = {}) => {
  const store = useOpenPLCStoreApi()
  const ROWS_NOT_SELECTED = -1
  // Multi-mount support: every open POU's VariablesEditor reads ITS
  // OWN model via the shared `selectEditorForPou` helper.  This is
  // the same selector the graphical editors use through
  // `useBoundEditorModel()` — kept centralised so the active-editor
  // preference + hidden-snapshot fallback can't drift between the
  // textual and graphical multi-mount paths.
  const editor = useOpenPLCStore((s) => selectEditorForPou(s, propName))
  const isEditingLocked = useIsEditingLocked()
  const {
    ladderFlows,
    ladderFlowActions: { updateNode, updateNodes },
    fbdFlows,
    fbdFlowActions: { updateNode: updateFBDNode, updateNodes: updateFBDNodes },
    workspace: {
      systemConfigs: { shouldUseDarkMode },
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
      setPouVariablesText,
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
    return declarationTextFor(
      pous.find((candidate) => candidate.name === editor.meta.name),
      tableData,
    )
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
  const isFunction = pou?.pouType === 'function'
  const [filtersOn, setFiltersOn] = useState(false)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; row: number } | null>(null)
  const closeRowMenu = useCallback(() => setRowMenu(null), [])
  const actionsSlot = useEditorActionsSlot()

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
      // The store patches `variablesText` on every table mutation, so it is
      // already current here; reading it keeps the comments the model cannot
      // carry.
      setEditorCode(
        declarationTextFor(
          pous.find((candidate) => candidate.name === editor.meta.name),
          tableData,
        ),
      )
    }
  }, [tableData, editorVariables.display, editor.meta.name, pous])

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
          : declarationTextFor(targetPou, targetPou?.interface?.variables ?? []),
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

      // `commitCode` owns the watermark — setting it here would pin pre-commit text and re-commit a no-op.
      const release = () => {
        isParsingRef.current = false
      }
      void commitCodeRef.current().then(release, release)
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

  /** Adds a variable copied from the selected row: below it, above it, or at the end of the table. */
  const handleCreateVariable = ({ position = 'below' }: { position?: 'above' | 'below' | 'end' } = {}) => {
    if (editorVariables.display === 'code') return

    pushToHistory(editor.meta.name)

    const matchedPou = pous.find((p) => p.name === editor.meta.name)
    const variables = matchedPou?.interface?.variables ?? []
    const selectedRow = position === 'end' ? ROWS_NOT_SELECTED : parseInt(editorVariables.selectedRow)

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
      rowToInsert: position === 'above' ? selectedRow : selectedRow + 1,
    })
    updateModelVariables({
      display: 'table',
      selectedRow: position === 'above' ? selectedRow : selectedRow + 1,
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

  /** Commits the POU description from the properties popover; leaving it unchanged is not an edit. */
  const commitDescription = (value: string) => {
    if (isEditingLocked || value === (pou?.documentation ?? '')) return
    updatePouDocumentation(editor.meta.name, value)
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const toggleColumnFilters = () => {
    if (filtersOn) handleFilterChange('All')
    setFiltersOn(!filtersOn)
  }

  /**
   * The row shortcuts: they act on the selected row only while the table container itself has the focus, never from a
   * cell's field, dropdown or button, whose own keys they must not take.
   */
  const handleTableKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditingLocked || editorVariables.display !== 'table') return
    if (event.target !== event.currentTarget) return
    const selected = parseInt(editorVariables.selectedRow)
    if (event.key === 'Enter') handleCreateVariable({ position: event.shiftKey ? 'above' : 'below' })
    else if (event.altKey && event.key === 'ArrowUp' && selected > 0) handleRearrangeVariables(-1)
    else if (event.altKey && event.key === 'ArrowDown' && selected >= 0 && selected < tableData.length - 1)
      handleRearrangeVariables(1)
    else if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== ROWS_NOT_SELECTED)
      handleRemoveVariable()
    else return
    event.preventDefault()
  }

  const handleRowContextMenu = (rowIndex: number, event: ReactMouseEvent<HTMLTableRowElement>) => {
    event.preventDefault()
    updateModelVariables({ display: 'table', selectedRow: rowIndex })
    setRowMenu({ x: event.clientX, y: event.clientY, row: rowIndex })
  }

  const rowMenuItems: RungMenuItem[] = rowMenu
    ? [
        {
          label: 'Insert row above',
          shortcut: '⇧Enter',
          disabled: isEditingLocked,
          onSelect: () => handleCreateVariable({ position: 'above' }),
        },
        {
          label: 'Insert row below',
          shortcut: 'Enter',
          disabled: isEditingLocked,
          onSelect: () => handleCreateVariable({ position: 'below' }),
        },
        null,
        {
          label: 'Move up',
          shortcut: IS_MAC ? '⌥↑' : 'Alt + ↑',
          disabled: isEditingLocked || rowMenu.row === 0,
          onSelect: () => handleRearrangeVariables(-1, rowMenu.row),
        },
        {
          label: 'Move down',
          shortcut: IS_MAC ? '⌥↓' : 'Alt + ↓',
          disabled: isEditingLocked || rowMenu.row >= tableData.length - 1,
          onSelect: () => handleRearrangeVariables(1, rowMenu.row),
        },
        null,
        {
          label: 'Delete variable',
          shortcut: IS_MAC ? '⌫' : 'Del',
          disabled: isEditingLocked,
          danger: true,
          onSelect: handleRemoveVariable,
        },
      ]
    : []

  const classFilter = editorVariables.display === 'table' ? editorVariables.classFilter : 'All'
  const classFilterHeader = (
    <Select value={classFilter} onValueChange={handleFilterChange}>
      <SelectTrigger
        aria-label='Class filter'
        placeholder={classFilter === 'All' ? 'Class' : `Class: ${classFilter}`}
        withIndicator
        className='flex h-full w-full items-center justify-center gap-1 outline-none'
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
            <span className='text-xs font-normal text-neutral-700 dark:text-neutral-500'>{filter}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

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

      // Same gate the table applies cell by cell. Without it the text path
      // wrote straight through `setPouVariables`, which never validates, so a
      // declaration the table refuses was accepted the moment it was typed
      // instead of picked (DOPE-650).
      const validation = validateVariableSet(newVariables)
      if (!validation.ok) {
        const [first] = validation.errors
        throw new Error(`${first.title} ${first.message}`)
      }

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
      } = store.getState()

      const freshPou = freshPous.find((p) => p.name === editor.meta.name)
      const freshVariables = freshPou?.interface?.variables ?? []

      if (language === 'ld') {
        syncNodesWithVariablesUtil(freshVariables, freshLadderFlows, updateNodes)
      }

      if (language === 'fbd') {
        syncNodesWithVariablesFBDUtil(freshVariables, freshFBDFlows, updateFBDNodes)
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

      // The text the user wrote IS the declaration (DOPE-650) — record it as
      // the POU's, rather than clearing it and letting a serialisation of the
      // model take its place.
      //
      // The buffer is deliberately left alone. It used to be replaced with
      // `generateIecVariablesToString(freshVariables)` so it would match the
      // synthesised LSP document line for line and keep its colours; that
      // re-canonicalisation is what deleted every comment the moment the user
      // clicked away. The LSP stub is now built from this same text
      // (`serializePouSignatureToSTWithBodyOffset`), so the two agree without
      // anything having to be rewritten.
      // Reconcile the typed text against what was actually committed before
      // storing it. `finalVariables` is not always what the buffer says: when
      // the user DECLINES a type change in the modal, the old type is restored
      // in the model while the buffer still carries the new one. Storing the
      // buffer verbatim would let the declined type win, because this text is
      // what gets serialised to disk and fed to the LSP stub — the user's "no"
      // would silently become a yes on the next save (CodeRabbit, PR #1130).
      //
      // `applyVariablesToText` returns the text unchanged when nothing differs,
      // which is the overwhelmingly common case, so the comments and spacing
      // still survive byte for byte.
      const committedText = applyVariablesToText(
        editorCode,
        finalVariables,
        buildTypeContext(pous, dataTypes, libraries),
      )
      if (committedText !== editorCode) setEditorCode(committedText)
      setPouVariablesText(editor.meta.name, committedText)
      lastParsedCodeRef.current = committedText

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
        {_isActive &&
          actionsSlot &&
          createPortal(
            <div role='group' aria-label='Editor actions' className='flex h-fit w-fit items-center rounded-md'>
              <ActionTile
                label='Column filters'
                title='Column filters'
                on={filtersOn}
                disabled={editorVariables.display !== 'table'}
                onClick={toggleColumnFilters}
                path='M10 9h10l-3.8 4.6V18l-2.4 1.2v-5.6z'
                className='rounded-l-md'
              />
              <ActionTile
                label='Variables table visualization'
                title='Table'
                on={editorVariables.display === 'table'}
                onClick={() => void handleVisualizationTypeChange('table')}
                path='M9 12H21M9 16H21M15 8V20M12.2 8H17.8C18.9 8 19.5 8 19.9 8.2C20.3 8.4 20.6 8.7 20.8 9.1C21 9.5 21 10.1 21 11.2V16.8C21 17.9 21 18.5 20.8 18.9C20.6 19.3 20.3 19.6 19.9 19.8C19.5 20 18.9 20 17.8 20H12.2C11.1 20 10.5 20 10.1 19.8C9.7 19.6 9.4 19.3 9.2 18.9C9 18.5 9 17.9 9 16.8V11.2C9 10.1 9 9.5 9.2 9.1C9.4 8.7 9.7 8.4 10.1 8.2C10.5 8 11.1 8 12.2 8Z'
              />
              <ActionTile
                label='Variables code visualization'
                title='Code'
                on={editorVariables.display === 'code'}
                onClick={() => void handleVisualizationTypeChange('code')}
                path='M18.3333 17.3333L21.6667 14L18.3333 10.6667M11.6667 10.6667L8.33333 14L11.6667 17.3333M16.3333 8L13.6667 20'
              />
              <Popover.Root>
                <Popover.Trigger asChild>
                  <ActionTile
                    label='POU properties'
                    title='POU properties'
                    path='M15 13.2V18M15 10.4v.1M21 14a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z'
                    className='rounded-r-md'
                  />
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side='bottom'
                    align='end'
                    sideOffset={6}
                    className='z-50 flex w-80 flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950'
                  >
                    <p className='font-semibold text-neutral-850 dark:text-neutral-300'>
                      {editor.meta.name}{' '}
                      <span className='font-normal text-neutral-500'>· {POU_TYPE_LABEL[pou?.pouType ?? ''] ?? ''}</span>
                    </p>
                    <textarea
                      aria-label='POU description'
                      key={pouDescription}
                      defaultValue={pouDescription}
                      readOnly={isEditingLocked}
                      placeholder='Description'
                      rows={4}
                      onBlur={(event) => commitDescription(event.target.value)}
                      className='resize-none rounded-md border border-neutral-300 bg-transparent p-2 text-neutral-850 outline-none read-only:cursor-not-allowed focus:border-brand dark:border-neutral-800 dark:text-neutral-300'
                    />
                    <p className='text-[11px] text-neutral-500'>
                      Shown as the block&apos;s help when it is used from the library.
                    </p>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </div>,
            actionsSlot,
          )}
        {editorVariables.display === 'table' && (
          <div
            aria-label='Variables editor table container'
            className='h-full overflow-x-auto overflow-y-auto outline-none lg:overflow-x-hidden'
            style={{ scrollbarGutter: 'stable' }}
            tabIndex={-1}
            onKeyDown={handleTableKeyDown}
          >
            <VariablesTable
              tableData={tableData}
              filterValue={editorVariables.classFilter.toLowerCase()}
              columnFilters={columnFilters}
              setColumnFilters={setColumnFilters}
              selectedRow={parseInt(editorVariables.selectedRow)}
              handleRowClick={handleRowClick}
              classHeader={filtersOn ? classFilterHeader : undefined}
              returnRow={
                isFunction
                  ? {
                      name: editor.meta.name,
                      type: returnType,
                      options: returnTypeOptions,
                      disabled: isEditingLocked,
                      onChange: handleReturnTypeChange,
                    }
                  : undefined
              }
              onAddVariable={() => handleCreateVariable({ position: 'end' })}
              addDisabled={isEditingLocked}
              onRowContextMenu={handleRowContextMenu}
            />
            {rowMenu && <RungMenu at={rowMenu} items={rowMenuItems} onClose={closeRowMenu} />}
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
