import * as PrimitivePopover from '@radix-ui/react-popover'
import { useAliasRegistry } from '@root/frontend/hooks/use-alias-registry'
import { useProjectAliasBindings } from '@root/frontend/hooks/use-project-alias-bindings'
import { useTargetCapabilities } from '@root/frontend/hooks/use-target-capabilities'
import { isLiteralLocation } from '@root/middleware/shared/utils/iec-address/registry'
import type { CellContext, RowData } from '@tanstack/react-table'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { pinSelectors, remoteDeviceSelectors, vendorIoSelectors } from '../../../hooks/use-store-selectors'
import { useOpenPLCStore } from '../../../store'
import { ProjectResponse } from '../../../store/slices/project'
import { cn } from '../../../utils/cn'
import { isLegalIdentifier, sanitizeVariableInput } from '../../../utils/keywords'
import { buildLocationDropdownOptions } from '../../../utils/location-dropdown-options'
import {
  findAllReferencesToVariable,
  propagateVariableRename,
  type ReferenceImpactAnalysis,
} from '../../../utils/variable-references'
import { GenericComboboxCell } from '../../_atoms/generic-table-inputs/generic-combobox-cell'
import { HighlightedText } from '../../_atoms/highlighted-text'
import { InputWithRef } from '../../_atoms/input'
import { LocationWarningGlyph } from '../../_atoms/location-warning-glyph'
import { useToast } from '../../_features/[app]/toast/use-toast'
import { RenameImpactModal } from '../rename-impact-modal'

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
    projectActions: { getVariable, updatePou, updateVariable },
    project: {
      data: { pous, configurations },
    },
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)
  const [isEditing, setIsEditing] = useState(false)
  const [variable, setVariable] = useState<PLCVariable | undefined>(undefined)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [impactAnalysis, setImpactAnalysis] = useState<ReferenceImpactAnalysis | null>(null)
  const confirmResolveRef = useRef<(v: boolean) => void>()

  const globalVariables = configurations.resource.globalVariables

  const isExternalVariable = variable?.class === 'external'

  const globalVariableOptions = useMemo(() => {
    return globalVariables
      .filter((gv) => gv.name) // Only include variables with names
      .map((gv) => ({
        id: `global-${gv.name}`,
        value: gv.name,
        label: `${gv.name} : ${gv.type.value.toUpperCase()}`,
      }))
  }, [globalVariables])

  const isCellEditable = () => {
    if (isDebuggerVisible) return false

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

  const isEditable = useCallback(isCellEditable, [id, variable, isDebuggerVisible])

  const askRenameBlocks = () =>
    new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve
      setConfirmOpen(true)
    })

  const handleExternalVariableSelection = (selectedName: string) => {
    const matchingGlobalVar = globalVariables.find((gv) => gv.name.toLowerCase() === selectedName.toLowerCase())

    if (!matchingGlobalVar) {
      toast({
        title: 'Error',
        description: `Global variable '${selectedName}' not found`,
        variant: 'fail',
      })
      return
    }

    const nameRes = table.options.meta?.updateData(index, 'name', selectedName)

    if (!nameRes?.ok) {
      toast({ title: nameRes?.title, description: nameRes?.message, variant: 'fail' })
      return
    }

    const typeRes = table.options.meta?.updateData(index, 'type', matchingGlobalVar.type)

    if (!typeRes?.ok) {
      toast({
        title: 'Warning',
        description: 'Variable name updated but type could not be auto-filled',
        variant: 'fail',
      })
    }

    if (matchingGlobalVar.documentation) {
      table.options.meta?.updateData(index, 'documentation', matchingGlobalVar.documentation)
    }

    setCellValue(selectedName)
  }

  const onBlur = async () => {
    if (cellValue === initialValue) return setIsEditing(false)

    const oldName = initialValue
    const newName = cellValue

    const [isNameLegal, reason] = isLegalIdentifier(newName)
    if (isNameLegal === false) {
      toast({ title: 'Error', description: `'${newName}' ${reason}`, variant: 'fail' })
      setCellValue(oldName)
      setIsEditing(false)
      return
    }

    if (!variable) {
      toast({ title: 'Error', description: 'Variable not found', variant: 'fail' })
      setCellValue(oldName)
      setIsEditing(false)
      return
    }

    if (variable.class === 'external') {
      const matchingGlobalVar = globalVariables.find((gv) => gv.name.toLowerCase() === newName.toLowerCase())

      if (!matchingGlobalVar) {
        toast({
          title: 'Error',
          description: `External variable '${newName}' must reference an existing global variable`,
          variant: 'fail',
        })
        setCellValue(oldName)
        setIsEditing(false)
        return
      }

      const typeMatches =
        matchingGlobalVar.type.definition === variable.type.definition &&
        matchingGlobalVar.type.value.toUpperCase() === variable.type.value.toUpperCase()

      if (!typeMatches) {
        toast({
          title: 'Error',
          description: `Type mismatch: external variable type must match global variable '${matchingGlobalVar.name}' (${matchingGlobalVar.type.value})`,
          variant: 'fail',
        })
        setCellValue(oldName)
        setIsEditing(false)
        return
      }
    }

    const analysisScope = scope === 'global' || variable.class === 'external' ? 'global' : 'local'

    const impact = findAllReferencesToVariable(
      oldName,
      variable.type,
      editor.meta.name,
      pous,
      ladderFlows,
      fbdFlows,
      analysisScope,
    )

    let shouldPropagate = true
    if (impact.totalReferences > 0) {
      setImpactAnalysis(impact)
      shouldPropagate = await askRenameBlocks()
      setImpactAnalysis(null)
    }

    const res = table.options.meta?.updateData(index, id, newName)

    if (!res?.ok) {
      setCellValue(initialValue)
      toast({ title: res?.title, description: res?.message, variant: 'fail' })
      return
    }

    if (shouldPropagate && impact.totalReferences > 0) {
      propagateVariableRename(
        oldName,
        newName,
        impact.references,
        ladderFlows,
        fbdFlows,
        pous,
        { updateNode },
        { updateNode: updateFBDNode },
        { updatePou, updateVariable },
        analysisScope,
      )
    }

    setIsEditing(false)
  }

  const handleStartEditing = () => {
    if (!isEditable()) return
    setIsEditing(true)
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    setVariable(
      getVariable({
        rowId: index,
        scope,
        associatedPou: editor.meta.name,
      }),
    )
  }, [editor.meta.name, index, table.options.data, scope, getVariable])

  return (
    <>
      {confirmOpen && impactAnalysis && (
        <RenameImpactModal
          open={confirmOpen}
          oldName={initialValue}
          newName={cellValue}
          impact={impactAnalysis}
          onConfirm={() => {
            confirmResolveRef.current?.(true)
            setConfirmOpen(false)
          }}
          onCancel={() => {
            confirmResolveRef.current?.(false)
            setConfirmOpen(false)
          }}
        />
      )}

      {isEditing && isExternalVariable && selected ? (
        <GenericComboboxCell
          value={cellValue}
          onValueChange={(value) => {
            handleExternalVariableSelection(value)
            setIsEditing(false)
          }}
          selectValues={globalVariableOptions}
          selected={selected}
          openOnSelectedOption={false}
          canAddACustomOption={false}
        />
      ) : isEditing ? (
        <InputWithRef
          value={cellValue}
          onChange={(e) => setCellValue(e.target.value)}
          onBlur={() => void onBlur()}
          onInput={(e) => sanitizeVariableInput(e.currentTarget)}
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
          <HighlightedText
            text={cellValue}
            searchQuery={searchQuery}
            className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {})}
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

  const {
    editor,
    searchQuery,
    projectActions: { getVariable },
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)
  const [isEditing, setIsEditing] = useState(false)
  const [variable, setVariable] = useState<PLCVariable | undefined>(undefined)

  const isCellEditable = () => {
    if (isDebuggerVisible) return false

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

  const isEditable = useCallback(isCellEditable, [id, variable, isDebuggerVisible])

  const onBlur = () => {
    if (cellValue === initialValue) return setIsEditing(false)

    // The decision was made to validate this issue at a later stage.

    // if (id === 'initialValue' && variable?.type?.value) {
    //   const validation = validateInitialValue(cellValue, variable.type.value)

    //   if (!validation.valid) {
    //     toast({ title: 'Error', description: validation.message, variant: 'fail' })
    //     setCellValue('')
    //     setIsEditing(false)
    //     return
    //   }
    // }

    table.options.meta?.updateData(index, id, cellValue)
    setIsEditing(false)
  }

  const handleStartEditing = () => {
    if (!isEditable()) return
    setIsEditing(true)
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    setVariable(
      getVariable({
        rowId: index,
        scope,
        associatedPou: editor.meta.name,
      }),
    )
  }, [editor.meta.name, index, table.options.data, scope, getVariable])

  return isEditing ? (
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
      <HighlightedText
        text={cellValue}
        searchQuery={searchQuery}
        className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {})}
      />
    </div>
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
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()
  const existingPins = pinSelectors.usePins()
  const remoteIOPoints = remoteDeviceSelectors.useRemoteDeviceIOPoints()
  const vendorIoEntries = vendorIoSelectors.useVendorIoEntries()
  // Target-capability gate: the project file can carry persisted state
  // from previously-active targets (e.g. SLM-RP4 VPP-module entries
  // left over from a project authored against runtime v4, kept on
  // disk so switching back doesn't lose work). The address pool
  // already scopes claims by `caps.<producer>`; mirror that here so
  // the dropdown only surfaces addresses the active target can
  // actually drive. Without this filter, switching SLM-RP4 → Arduino
  // Mega leaves both `%QX0.0` rows (Arduino pin + stale VPP slot 1)
  // in the picker.
  const capabilities = useTargetCapabilities()

  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)
  // const [isEditing, setIsEditing] = useState(false)
  const [variable, setVariable] = useState<PLCVariable | undefined>(undefined)

  const isCellEditable = () => {
    if (isDebuggerVisible) return false

    const disallowedLocationClasses = ['input', 'output', 'inOut', 'external', 'temp']
    if (id === 'location' && disallowedLocationClasses.includes(variable?.class || '')) {
      return false
    }

    return true
  }

  const isEditable = useCallback(isCellEditable, [id, variable, isDebuggerVisible])

  // Orphan check for the single-field location model. `location` is the
  // binding: a literal `%addr` (manual) OR an alias name. It is "orphaned"
  // when it holds an alias NAME that no active producer declares — the
  // variable resolves to nothing (unlocated) at compile time, so we flag it.
  // A literal address is never orphaned; an empty location is simply
  // unlocated (no warning). `isLocationCell` scopes the check to the
  // location column (the same cell renders name/type/etc.).
  const aliasRegistry = useAliasRegistry()
  const isLocationCell = id === 'location'
  const locationValue = variable?.location ?? ''
  const isOrphaned =
    isLocationCell &&
    locationValue.length > 0 &&
    !isLiteralLocation(locationValue) &&
    !aliasRegistry.byAlias.has(locationValue)
  // Manual-location conflict: a literal `%addr` that collides with an alias a
  // variable elsewhere is bound to. IEC located addresses are GLOBAL, so the
  // conflicting variable can live in any POU or the global scope — the scan
  // is project-wide. The alias resolves to the same `%addr` at compile time,
  // so the two variables would occupy one location, which the compiler
  // rejects. Clearing the other variable's binding clears this warning.
  // Flagged with the same glyph as an orphaned alias; we flag the manual
  // entry, not the aliased one (the alias is the canonical binding).
  const aliasBindings = useProjectAliasBindings()
  const locationConflict =
    isLocationCell && isLiteralLocation(locationValue)
      ? aliasBindings.find((binding) => binding.address === locationValue)
      : undefined
  const isManualConflict = locationConflict !== undefined
  const hasLocationWarning = isOrphaned || isManualConflict

  // When the input is blurred, we'll call our table meta's updateData function
  const onBlur = (value: string) => {
    // Short-circuit unchanged-value blurs so re-focus doesn't fire a
    // gratuitous state update.
    if (value === initialValue) return
    const res = table.options.meta?.updateData(index, id, value)
    if (res?.ok) {
      setCellValue(value)
      return
    }
    setCellValue(initialValue)
    toast({ title: res?.title, description: res?.message, variant: 'fail' })
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    setVariable(
      getVariable({
        rowId: index,
        scope,
        associatedPou: editor.meta.name,
      }),
    )
  }, [editor.meta.name, index, table.options.data, scope, getVariable])

  const selectableValues = useCallback(
    () =>
      buildLocationDropdownOptions({
        cellId: id,
        pins: existingPins,
        remoteIOPoints,
        vendorIoEntries,
        capabilities,
      }),
    [id, existingPins, remoteIOPoints, vendorIoEntries, capabilities],
  )

  // Single-field display: `location` is shown verbatim — the alias name when
  // the variable is alias-bound, the literal address when manual. The
  // combobox `value` is the same string, so picking an alias option (whose
  // value is the alias name) or typing a literal both operate on `location`.
  const warningTooltip = isOrphaned
    ? `Alias "${cellValue}" is not declared by any active I/O source — this variable is unlocated at compile time.`
    : locationConflict
      ? `Address ${cellValue} conflicts with alias "${locationConflict.aliasName}" assigned to "${locationConflict.variableName}". Two variables cannot share a location.`
      : undefined

  // The warning glyph must stay visible whether or not the row is selected.
  // The selected branch renders an editable combobox; previously the glyph
  // lived only in the display branch, so an active conflict/orphan looked
  // unflagged the moment the row was selected. Render it in both branches.
  const warningGlyph =
    hasLocationWarning && warningTooltip ? (
      <LocationWarningGlyph
        label={isManualConflict ? 'Address conflicts with an alias' : 'Orphaned alias'}
        tooltip={warningTooltip}
      />
    ) : null

  // The read-only rule must gate the selected branch too: without the
  // `isEditable()` check the combobox rendered fully interactive on any
  // selected row, letting the user attach a location to an interface-class
  // (input/output/inOut/external/temp) variable — an invalid declaration
  // that broke the project on reopen (GitHub issue #904).
  return selected && isEditable() ? (
    <div className='flex w-full flex-1 items-center gap-1'>
      {warningGlyph}
      <GenericComboboxCell
        value={cellValue}
        displayLabel={cellValue}
        onValueChange={(value) => {
          onBlur(value)
        }}
        selectValues={selectableValues()}
        selected={selected}
        openOnSelectedOption
        canAddACustomOption
        // An orphaned alias name resolves to nothing at compile; keep "Clear"
        // enabled even when empty so the user can drop it.
        allowClearWhenEmpty={id === 'location' && isOrphaned}
      />
    </div>
  ) : (
    <div
      className={cn(
        'flex w-full flex-1 items-center justify-center gap-1 bg-transparent p-2 text-center outline-none',
        {
          'pointer-events-none': !selected,
          'cursor-not-allowed': !isEditable(),
        },
      )}
    >
      {warningGlyph}
      <HighlightedText
        text={cellValue}
        searchQuery={searchQuery}
        className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {
          'text-amber-600 dark:text-amber-400': hasLocationWarning,
        })}
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
  const {
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()
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
      <PrimitivePopover.Trigger asChild disabled={isDebuggerVisible}>
        <div
          className={cn('flex h-full w-full cursor-text items-center justify-center p-2', {
            'pointer-events-none': !selected || isDebuggerVisible,
            'cursor-not-allowed': isDebuggerVisible,
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
          className='box h-fit w-[175px] rounded-lg bg-white p-2 dark:bg-neutral-950 lg:w-[275px] 2xl:w-[375px]'
          onInteractOutside={onBlur}
        >
          <textarea
            value={cellValue}
            onChange={(e) => setCellValue(e.target.value)}
            rows={5}
            autoComplete='off'
            className='w-full max-w-[375px] flex-1 resize-none  bg-transparent text-start text-neutral-900 outline-none  dark:text-neutral-100'
          />
        </PrimitivePopover.Content>
      </PrimitivePopover.Portal>
    </PrimitivePopover.Root>
  )
}

export { EditableDocumentationCell, EditableInitialValueCell, EditableLocationCell, EditableNameCell }
