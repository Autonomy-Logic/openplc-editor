import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon, DebuggerIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import {
  TypeChangeValidationResult,
  validateTypeChange,
} from '@root/renderer/store/slices/project/validation/type-change'
import { propagateVariableTypeChange } from '@root/renderer/utils/variable-references'
import type { PLCGlobalVariable, PLCVariable } from '@root/types/PLC/open-plc'
import { baseTypeSchema } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { TypeChangeModal } from '../type-change-modal'

type ISelectableCellProps = CellContext<PLCVariable, unknown> & { editable?: boolean }

const createVariableType = (
  definition: PLCVariable['type']['definition'],
  value: string,
): PLCVariable['type'] | null => {
  switch (definition) {
    case 'base-type':
      return {
        definition: 'base-type',
        value: value as Extract<PLCVariable['type'], { definition: 'base-type' }>['value'],
      }
    case 'user-data-type':
      return { definition: 'user-data-type', value }
    case 'derived':
      return { definition: 'derived', value }
    case 'array':
      return null
    default:
      return null
  }
}

const SelectableTypeCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const {
    project: {
      data: { dataTypes, pous },
    },
    ladderFlows,
    fbdFlows,
    projectActions: { updateVariable },
  } = useOpenPLCStore()

  const VariableTypes = [
    {
      definition: 'base-type',
      values: baseTypeSchema.options,
    },
    { definition: 'user-data-type', values: dataTypes.map((dataType) => dataType.name) },
  ]
  const { value, definition } = getValue<PLCGlobalVariable['type']>()
  const [cellValue, setCellValue] = useState<PLCGlobalVariable['type']['value']>(value)

  const [poppoverIsOpen, setPoppoverIsOpen] = useState(false)
  const [typeChangeModalOpen, setTypeChangeModalOpen] = useState(false)
  const [pendingTypeChange, setPendingTypeChange] = useState<{
    definition: PLCVariable['type']['definition']
    value: PLCVariable['type']['value']
  } | null>(null)
  const [validationResult, setValidationResult] = useState<TypeChangeValidationResult | null>(null)

  const currentVariable = table.options.data[index]
  const variableName = currentVariable.name

  const applyTypeChange = (definition: PLCVariable['type']['definition'], value: PLCVariable['type']['value']) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, { definition, value })

    const newType = createVariableType(definition, value)
    if (newType) {
      propagateVariableTypeChange(variableName, newType, pous, { updateVariable })
    }
  }

  const onSelect = (definition: PLCGlobalVariable['type']['definition'], value: PLCGlobalVariable['type']['value']) => {
    const oldType = currentVariable.type

    if (oldType.value === value && oldType.definition === definition) {
      return
    }

    const newType = createVariableType(definition, value)

    if (!newType) {
      applyTypeChange(definition, value)
      return
    }

    const validation = validateTypeChange(variableName, oldType, newType, ladderFlows, fbdFlows, 'global', pous)

    if (validation.affectedNodes.length > 0 || validation.warnings.length > 0) {
      setPendingTypeChange({ definition, value })
      setValidationResult(validation)
      setTypeChangeModalOpen(true)
      setPoppoverIsOpen(false)
      return
    }

    applyTypeChange(definition, value)
  }

  const handleTypeChangeConfirm = () => {
    if (pendingTypeChange) {
      applyTypeChange(pendingTypeChange.definition, pendingTypeChange.value)
    }
    setTypeChangeModalOpen(false)
    setPendingTypeChange(null)
    setValidationResult(null)
  }

  const handleTypeChangeCancel = () => {
    setTypeChangeModalOpen(false)
    setPendingTypeChange(null)
    setValidationResult(null)
  }

  useEffect(() => {
    setCellValue(value)
  }, [value])

  return (
    <>
      {validationResult &&
        pendingTypeChange &&
        (() => {
          const newType = createVariableType(pendingTypeChange.definition, pendingTypeChange.value)
          if (!newType) return null
          return (
            <TypeChangeModal
              open={typeChangeModalOpen}
              variableName={variableName}
              oldType={currentVariable.type}
              newType={newType}
              validation={validationResult}
              onConfirm={handleTypeChangeConfirm}
              onCancel={handleTypeChangeCancel}
            />
          )
        })()}
      <PrimitiveDropdown.Root onOpenChange={setPoppoverIsOpen} open={poppoverIsOpen}>
        <PrimitiveDropdown.Trigger asChild>
          <div
            className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none', {
              'pointer-events-none': !editable,
            })}
          >
            <span className='line-clamp-1 font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {cellValue === null
                ? ''
                : definition === 'array' || definition === 'derived'
                  ? cellValue
                  : _.upperCase(cellValue as unknown as string)}
            </span>
          </div>
        </PrimitiveDropdown.Trigger>
        <PrimitiveDropdown.Portal>
          <PrimitiveDropdown.Content
            side='bottom'
            sideOffset={-20}
            className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
          >
            {VariableTypes.map((scope) => (
              <PrimitiveDropdown.Sub key={scope.definition}>
                <PrimitiveDropdown.SubTrigger asChild>
                  <div className='relative flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'>
                    <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                      {_.startCase(scope.definition)}
                    </span>
                    <ArrowIcon size='md' direction='right' className='absolute right-1' />
                  </div>
                </PrimitiveDropdown.SubTrigger>
                <PrimitiveDropdown.Portal>
                  <PrimitiveDropdown.SubContent
                    sideOffset={5}
                    className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                  >
                    {scope.values.map((value) => (
                      <PrimitiveDropdown.Item
                        key={value}
                        onSelect={() => onSelect(scope.definition as PLCGlobalVariable['type']['definition'], value)}
                        className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                      >
                        <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                          {_.upperCase(value)}
                        </span>
                      </PrimitiveDropdown.Item>
                    ))}
                  </PrimitiveDropdown.SubContent>
                </PrimitiveDropdown.Portal>
              </PrimitiveDropdown.Sub>
            ))}

            <PrimitiveDropdown.Item asChild></PrimitiveDropdown.Item>
          </PrimitiveDropdown.Content>
        </PrimitiveDropdown.Portal>
      </PrimitiveDropdown.Root>
    </>
  )
}
const VariableClasses = ['input', 'output', 'inOut', 'external', 'local', 'temp']

const SelectableClassCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const initialValue = getValue()

  const [cellValue, setCellValue] = useState(initialValue)

  const onValueChange = (value: string) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, value)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <Select value={cellValue as string} onValueChange={(value) => onValueChange(value)}>
      <SelectTrigger
        placeholder={cellValue as string}
        className={cn(
          'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
          { 'pointer-events-none': !editable },
        )}
      />
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {VariableClasses.map((type) => (
          <SelectItem
            key={type}
            value={type}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {_.startCase(type)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const SelectableDebugCell = ({ getValue, row: { index }, column: { id }, table }: ISelectableCellProps) => {
  const initialValue = getValue<boolean>()

  const [cellValue, setCellValue] = useState(initialValue)

  const onClick = () => {
    setCellValue(!cellValue)
    table.options.meta?.updateData(index, id, !cellValue)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <button className='flex h-full w-full cursor-pointer items-center justify-center' onClick={onClick}>
      <DebuggerIcon variant={cellValue ? 'default' : 'muted'} />
    </button>
  )
}

export { SelectableClassCell, SelectableDebugCell, SelectableTypeCell }
