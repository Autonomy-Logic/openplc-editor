import * as PrimitivePopover from '@radix-ui/react-popover'
import { useAliasRegistry } from '@root/frontend/hooks/use-alias-registry'
import { useProjectAliasBindings } from '@root/frontend/hooks/use-project-alias-bindings'
import { isLiteralLocation } from '@root/middleware/shared/utils/iec-address/registry'
import type { CellContext, RowData } from '@tanstack/react-table'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { PLCGlobalVariable } from '../../../../middleware/shared/ports/types'
import { pinSelectors, remoteDeviceSelectors, vendorIoSelectors } from '../../../hooks/use-store-selectors'
import { useOpenPLCStore } from '../../../store'
import type { ProjectResponse } from '../../../store/slices/project'
import { cn } from '../../../utils/cn'
import { isLegalIdentifier, sanitizeVariableInput } from '../../../utils/keywords'
import { buildRemoteDeviceOptionGroups, buildVendorIoOptionGroups } from '../../../utils/remote-device-options'
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

type IEditableCellProps = CellContext<PLCGlobalVariable, unknown> & { editable?: boolean }
const EditableNameCell = ({ getValue, row: { index }, column: { id }, table, editable = true }: IEditableCellProps) => {
  const initialValue = getValue<string>()
  const { toast } = useToast()

  const {
    searchQuery,
    ladderFlows,
    ladderFlowActions: { updateNode },
    fbdFlows,
    fbdFlowActions: { updateNode: updateFBDNode },
    projectActions: { updatePou, updateVariable },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  const [cellValue, setCellValue] = useState(initialValue)
  const [isEditing, setIsEditing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [impactAnalysis, setImpactAnalysis] = useState<ReferenceImpactAnalysis | null>(null)
  const confirmResolveRef = useRef<(v: boolean) => void>()

  const currentVariable = table.options.data[index]

  const askRenameBlocks = () =>
    new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve
      setConfirmOpen(true)
    })

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

    const impact = findAllReferencesToVariable(
      oldName,
      currentVariable.type,
      'Resource',
      pous,
      ladderFlows,
      fbdFlows,
      'global',
    )

    let shouldPropagate = true
    if (impact.totalReferences > 0) {
      setImpactAnalysis(impact)
      shouldPropagate = await askRenameBlocks()
      setImpactAnalysis(null)
    }

    const res = table.options.meta?.updateData(index, id, cellValue)
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
        'global',
      )
    }

    setIsEditing(false)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  const handleStartEditing = () => {
    if (!editable) return
    setIsEditing(true)
  }

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

      {isEditing ? (
        <InputWithRef
          value={cellValue}
          onChange={(e) => setCellValue(e.target.value)}
          onBlur={() => void onBlur()}
          onInput={(e) => sanitizeVariableInput(e.currentTarget)}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
            'pointer-events-none': !editable,
          })}
        />
      ) : (
        <div
          onClick={handleStartEditing}
          className={cn('flex w-full flex-1 bg-transparent p-2 text-center', { 'pointer-events-none': !editable })}
        >
          <HighlightedText
            text={cellValue}
            searchQuery={searchQuery}
            className='h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all'
          />
        </div>
      )}
    </>
  )
}

const EditableDocumentationCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: IEditableCellProps) => {
  const initialValue = getValue<string | undefined>()

  const [cellValue, setCellValue] = useState(initialValue ?? '')

  const onBlur = () => {
    table.options.meta?.updateData(index, id, cellValue)
  }

  useEffect(() => {
    setCellValue(initialValue ?? '')
  }, [initialValue])

  return (
    <PrimitivePopover.Root>
      <PrimitivePopover.Trigger asChild>
        <div
          className={cn('flex h-full w-full cursor-text items-center justify-center p-2', {
            'pointer-events-none': !editable,
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

const EditableInitialValueCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: IEditableCellProps) => {
  const initialValue = getValue<string>()

  const { searchQuery } = useOpenPLCStore()

  const [cellValue, setCellValue] = useState(initialValue ?? '')
  const [isEditing, setIsEditing] = useState(false)

  const onBlur = () => {
    if (cellValue === initialValue) return setIsEditing(false)

    table.options.meta?.updateData(index, id, cellValue)
    setIsEditing(false)
  }

  const handleStartEditing = () => {
    if (!editable) return
    setIsEditing(true)
  }

  useEffect(() => {
    setCellValue(initialValue ?? '')
  }, [initialValue])

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
        'pointer-events-none': !editable,
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
  row: { index, original },
  column: { id },
  table,
  editable = true,
}: IEditableCellProps) => {
  const initialValue = getValue<string>()
  const { toast } = useToast()

  const { searchQuery } = useOpenPLCStore()
  const existingPins = pinSelectors.usePins()
  const remoteIOPoints = remoteDeviceSelectors.useRemoteDeviceIOPoints()
  const vendorIoEntries = vendorIoSelectors.useVendorIoEntries()

  const [cellValue, setCellValue] = useState(initialValue ?? '')

  // Orphan check for the single-field location model — see the local
  // variables-table cell for the full explanation. `location` is orphaned
  // when it holds an alias NAME no active producer declares (unlocated at
  // compile). Scoped to the location column.
  const aliasRegistry = useAliasRegistry()
  const isLocationCell = id === 'location'
  const locationValue = original?.location ?? ''
  const isOrphaned =
    isLocationCell &&
    locationValue.length > 0 &&
    !isLiteralLocation(locationValue) &&
    !aliasRegistry.byAlias.has(locationValue)
  // Manual-location conflict: a literal `%addr` that collides with an alias a
  // variable elsewhere is bound to. IEC located addresses are GLOBAL, so the
  // conflicting variable can live in any POU or the global scope — the scan is
  // project-wide. The alias resolves to the same `%addr` at compile time, so
  // the two variables would occupy one location, which the compiler rejects.
  // Clearing the other variable's binding clears this warning.
  const aliasBindings = useProjectAliasBindings()
  const locationConflict =
    isLocationCell && isLiteralLocation(locationValue)
      ? aliasBindings.find((binding) => binding.address === locationValue)
      : undefined
  const isManualConflict = locationConflict !== undefined
  const hasLocationWarning = isOrphaned || isManualConflict

  const onBlur = (value: string) => {
    // Short-circuit unchanged-value blurs.
    if (value === initialValue) return
    const res = table.options.meta?.updateData(index, id, value)
    if (res?.ok) {
      setCellValue(value)
      return
    }
    setCellValue(initialValue ?? '')
    toast({ title: res?.title, description: res?.message, variant: 'fail' })
  }

  useEffect(() => {
    setCellValue(initialValue ?? '')
  }, [initialValue])

  const selectableValues = useCallback(() => {
    const ainPins = existingPins
      .filter((pin) => pin.pinType === 'analogInput')
      .map((pin) => ({
        id: `${id}-${pin.pin}`,
        value: pin.address,
        label: `${pin.address} ${pin.alias ? `(${pin.alias})` : ''}`,
      }))
    const aoutPins = existingPins
      .filter((pin) => pin.pinType === 'analogOutput')
      .map((pin) => ({
        id: `${id}-${pin.pin}`,
        value: pin.address,
        label: `${pin.address} ${pin.alias ? `(${pin.alias})` : ''}`,
      }))

    const dinPins = existingPins
      .filter((pin) => pin.pinType === 'digitalInput')
      .map((pin) => ({
        id: `${id}-${pin.pin}`,
        value: pin.address,
        label: `${pin.address} ${pin.alias ? `(${pin.alias})` : ''}`,
      }))

    const doutPins = existingPins
      .filter((pin) => pin.pinType === 'digitalOutput')
      .map((pin) => ({
        id: `${id}-${pin.pin}`,
        value: pin.address,
        label: `${pin.address} ${pin.alias ? `(${pin.alias})` : ''}`,
      }))

    const remoteGroups = buildRemoteDeviceOptionGroups(id, remoteIOPoints)
    const vendorGroups = buildVendorIoOptionGroups(id, vendorIoEntries)

    return [
      { label: 'Analog Inputs', options: ainPins },
      { label: 'Analog Outputs', options: aoutPins },
      { label: 'Digital Inputs', options: dinPins },
      { label: 'Digital Outputs', options: doutPins },
      ...remoteGroups,
      ...vendorGroups,
    ]
  }, [id, existingPins, remoteIOPoints, vendorIoEntries])

  // Single-field display: show `location` verbatim (alias name when bound,
  // literal address when manual).
  const warningTooltip = isOrphaned
    ? `Alias "${cellValue}" is not declared by any active I/O source — this variable is unlocated at compile time.`
    : locationConflict
      ? `Address ${cellValue} conflicts with alias "${locationConflict.aliasName}" assigned to "${locationConflict.variableName}". Two variables cannot share a location.`
      : undefined

  // The warning glyph must stay visible whether or not the row is selected.
  // The editable branch renders a combobox; previously the glyph lived only in
  // the display branch, so an active conflict/orphan looked unflagged the
  // moment the row was selected. Render it in both branches.
  const warningGlyph =
    hasLocationWarning && warningTooltip ? (
      <LocationWarningGlyph
        label={isManualConflict ? 'Address conflicts with an alias' : 'Orphaned alias'}
        tooltip={warningTooltip}
      />
    ) : null

  return editable ? (
    <div className='flex w-full flex-1 items-center gap-1'>
      {warningGlyph}
      <GenericComboboxCell
        value={cellValue}
        displayLabel={cellValue}
        onValueChange={(value) => {
          onBlur(value)
        }}
        selectValues={selectableValues()}
        selected={editable}
        openOnSelectedOption
        canAddACustomOption
      />
    </div>
  ) : (
    <div
      className={cn(
        'flex w-full flex-1 items-center justify-center gap-1 bg-transparent p-2 text-center outline-none',
        {
          'pointer-events-none': !editable,
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

export { EditableDocumentationCell, EditableInitialValueCell, EditableLocationCell, EditableNameCell }
