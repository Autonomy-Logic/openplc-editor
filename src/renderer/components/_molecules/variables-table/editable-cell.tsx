import * as PrimitivePopover from '@radix-ui/react-popover'
import { pinSelectors, remoteDeviceSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { ProjectResponse } from '@root/renderer/store/slices/project'
import { buildRemoteDeviceOptionGroups } from '@root/renderer/utils/remote-device-options'
import {
  findAllReferencesToVariable,
  propagateVariableRename,
  type ReferenceImpactAnalysis,
} from '@root/renderer/utils/variable-references'
import type { PLCVariable } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { isLegalIdentifier, sanitizeVariableInput } from '@root/utils/keywords'
import type { CellContext, RowData } from '@tanstack/react-table'
import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { HighlightedText, InputWithRef } from '../../_atoms'
import { GenericComboboxCell } from '../../_atoms/generic-table-inputs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../_atoms/tooltip'
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
    snapshotActions: { addSnapshot },
    project: {
      data: { pous, configuration },
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

  const globalVariables = configuration.resource.globalVariables

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

    addSnapshot(editor.meta.name)
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

    addSnapshot(editor.meta.name)

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

  const isOrphaned = useMemo(() => {
    if (!variable || isExternalVariable || isDebuggerVisible) return false

    const analysisScope = scope === 'global' || variable.class === 'external' ? 'global' : 'local'

    const impact = findAllReferencesToVariable(
      variable.name,
      variable.type,
      editor.meta.name,
      pous,
      ladderFlows,
      fbdFlows,
      analysisScope,
    )
    return impact.totalReferences === 0
  }, [variable, editor.meta.name, pous, ladderFlows, fbdFlows, scope, isExternalVariable, isDebuggerVisible])

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
            'text-red-500': isOrphaned,
          })}
        >
          <div className='flex w-full items-center justify-center gap-2'>
            <HighlightedText
              text={cellValue}
              searchQuery={searchQuery}
              className={cn('h-4 max-w-[380px] overflow-hidden text-ellipsis break-all', {})}
            />
            {isOrphaned && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className='flex items-center justify-center'>
                      <TriangleAlert className='h-4 w-4 text-red-500' />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Unused variable</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
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

    const remoteGroups = buildRemoteDeviceOptionGroups(id, remoteIOPoints)

    return [
      { label: 'Analog Inputs', options: ainPins },
      { label: 'Analog Outputs', options: aoutPins },
      { label: 'Digital Inputs', options: dinPins },
      { label: 'Digital Outputs', options: doutPins },
      ...remoteGroups,
    ]
  }, [id, variable, existingPins, remoteIOPoints])

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
      <HighlightedText
        text={cellValue}
        searchQuery={searchQuery}
        className={cn('h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all', {})}
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
          className='box h-fit w-[175px] rounded-lg bg-white p-2 lg:w-[275px] 2xl:w-[375px] dark:bg-neutral-950'
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
