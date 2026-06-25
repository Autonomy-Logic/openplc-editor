import * as PrimitivePopover from '@radix-ui/react-popover'
import { useAliasRegistry } from '@root/frontend/hooks/use-alias-registry'
import { useTargetCapabilities } from '@root/frontend/hooks/use-target-capabilities'
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

  // Alias staleness checks.  Lifted above `onBlur` so the short-
  // circuit can take them into account.  Two flavours of staleness
  // both demand that the location-pick re-fires `updateVariable`
  // even when the picked value matches the cell's current address:
  //
  //   - `isOrphaned`: the variable's stored alias is no longer in the
  //     registry's `byAlias` (producer renamed/removed it).
  //     Re-picking the same address re-runs the auto-adopt and
  //     refreshes the alias against the live registry.
  //   - `isMismatched`: the variable carries an alias that points at
  //     a *different* address than its current location.  Happens when
  //     legacy projects authored before `createVariable`'s auto-adopt
  //     fix carried a stale alias from one row to the next through the
  //     "+ button" template spread.  Without this exception, clicking
  //     on the right alias for the current address would no-op because
  //     the address itself isn't changing — the user would have to
  //     pick a DIFFERENT alias first, then return to the desired one,
  //     to force the alias write through.
  const aliasRegistry = useAliasRegistry()
  const isOrphaned = !!variable?.alias && !aliasRegistry.byAlias.has(variable.alias)
  const isMismatched =
    !!variable?.alias && aliasRegistry.byAlias.has(variable.alias)
      ? aliasRegistry.byAlias.get(variable.alias)?.address !== variable.location
      : false

  // When the input is blurred, we'll call our table meta's updateData function
  const onBlur = (value: string) => {
    // Short-circuit unchanged-value blurs so re-focus doesn't fire a
    // gratuitous state update.  Exceptions for the location column,
    // see the `isOrphaned` / `isMismatched` block above.
    if (value === initialValue && !(id === 'location' && (isOrphaned || isMismatched))) return
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

  // Combined display: when the variable carries an alias, show it
  // alongside the raw address as "alias (address)" — same shape
  // across selected and unselected states so clicking a row doesn't
  // flip the cell's appearance. When there's no alias, only the
  // address shows. The combobox `value` stays as the raw address so
  // typing / picking still operates on the canonical form.
  const orphanTooltip = isOrphaned
    ? `Alias "${variable?.alias}" is no longer declared by any active source. Last known address: ${cellValue}`
    : undefined
  const combinedLabel = variable?.alias ? `${variable.alias} (${cellValue})` : cellValue

  return selected ? (
    <GenericComboboxCell
      value={cellValue}
      displayLabel={combinedLabel}
      onValueChange={(value) => {
        onBlur(value)
      }}
      selectValues={selectableValues()}
      selected={selected}
      openOnSelectedOption
      canAddACustomOption
      // Orphaned/mismatched aliases blank the location (sync clears it for
      // compilation) but leave a stale alias label. Keep "Clear" enabled even
      // when the location is empty so the user can drop the stale alias.
      allowClearWhenEmpty={id === 'location' && (isOrphaned || isMismatched)}
    />
  ) : (
    <div
      title={orphanTooltip ?? (variable?.alias ? `${variable.alias} -> ${cellValue}` : undefined)}
      className={cn(
        'flex w-full flex-1 items-center justify-center gap-1 bg-transparent p-2 text-center outline-none',
        {
          'pointer-events-none': !selected,
          'cursor-not-allowed': !isEditable(),
        },
      )}
    >
      {isOrphaned && (
        <span
          aria-label='Orphaned alias'
          className='text-amber-500 dark:text-amber-400'
          /* small inline-svg keeps the cell self-contained */
        >
          <svg viewBox='0 0 16 16' fill='currentColor' className='h-3.5 w-3.5' aria-hidden='true'>
            <path d='M8 1.5 1 14h14L8 1.5Zm0 4.25 5.13 9.13H2.87L8 5.75Zm-.75 3v3h1.5v-3h-1.5Zm0 4v1.25h1.5V12.75h-1.5Z' />
          </svg>
        </span>
      )}
      <HighlightedText
        text={combinedLabel}
        searchQuery={searchQuery}
        className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {
          'text-amber-600 dark:text-amber-400': isOrphaned,
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
