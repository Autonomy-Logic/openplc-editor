import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { DebuggerIcon } from '@root/renderer/assets'
import type { PLCVariable } from '@root/types/PLC/test'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'

type SelectableCellProps = CellContext<PLCVariable, unknown>

const VariableTypes = [
  {
    definition: 'base-type',
    value: [
      'bool',
      'sint',
      'int',
      'dint',
      'lint',
      'usint',
      'uint',
      'udint',
      'ulint',
      'real',
      'lreal',
      'time',
      'date',
      'tod',
      'dt',
      'string',
      'byte',
      'word',
      'dword',
      'lword',
      'loglevel',
    ],
  },
  {
    definition: 'user-data-type',
    value: ['type1', 'type2', 'type3'],
  },
  {
    definition: 'array',
    value: [
      {
        baseType: 'bool',
        dimensions: '1..2',
      },
    ],
  },
]

const SelectableTypeCell = ({ getValue, row: { index }, column: { id }, table }: SelectableCellProps) => {
  const { value } = getValue<PLCVariable['type']>()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState<PLCVariable['type']['value']>(value)

  // When the input is blurred, we'll call our table meta's updateData function
  const _onBlur = () => {
    // Todo: Must update the data in the store
    table.options.meta?.updateData(index, id, cellValue)
  }

  // If the value is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(value)
  }, [value])

  return (
    <PrimitiveDropdown.Root>
      <PrimitiveDropdown.Trigger asChild>
        <div className='flex h-full w-full cursor-pointer justify-center outline-none'>
          <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
            {cellValue === null ? '' : (cellValue as unknown as string)}
          </span>
        </div>
      </PrimitiveDropdown.Trigger>
      <PrimitiveDropdown.Portal>
        <PrimitiveDropdown.Content
          side='bottom'
          sideOffset={-20}
          className='h-fit w-[200px] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
        >
          {VariableTypes.map((scope) => (
            <PrimitiveDropdown.Sub key={scope.definition}>
              <PrimitiveDropdown.SubTrigger asChild>
                <div className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'>
                  <span className='font-caption text-xs font-medium text-neutral-950 dark:text-neutral-200'>
                    {_.upperCase(scope.definition)}
                  </span>
                </div>
              </PrimitiveDropdown.SubTrigger>
              <PrimitiveDropdown.Portal>
                <PrimitiveDropdown.SubContent
                  sideOffset={5}
                  className='h-fit w-[200px] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                >
                  {scope.value.map((value) => (
                    <PrimitiveDropdown.Item
                      key={value}
                      onSelect={() => setCellValue(value as PLCVariable['type']['value'])}
                      // value={value}
                      className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                    >
                      <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                        {value}
                      </span>
                    </PrimitiveDropdown.Item>
                  ))}
                </PrimitiveDropdown.SubContent>
              </PrimitiveDropdown.Portal>
            </PrimitiveDropdown.Sub>
          ))}
        </PrimitiveDropdown.Content>
      </PrimitiveDropdown.Portal>
    </PrimitiveDropdown.Root>
  )
}
const VariableClasses = ['input', 'output', 'inOut', 'external', 'local', 'temp']

const SelectableClassCell = ({ getValue, row: { index }, column: { id }, table }: SelectableCellProps) => {
  const initialValue = getValue()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const _onBlur = () => {
    // Todo: Must update the data in the store
    table.options.meta?.updateData(index, id, cellValue)
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <Select value={cellValue as string} onValueChange={(value) => setCellValue(value)}>
      <SelectTrigger
        placeholder={cellValue as string}
        className='flex h-full w-full justify-center font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300'
      />
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='h-fit w-[200px] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
      >
        {VariableClasses.map((type) => (
          <SelectItem
            key={type}
            value={type}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {type}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const SelectableDebugCell = ({ getValue, row: { index }, column: { id }, table }: SelectableCellProps) => {
  const initialValue = getValue<boolean>()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const _onBlur = () => {
    // Todo: Must update the data in the store
    table.options.meta?.updateData(index, id, cellValue)
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <div
      className='flex h-full w-full cursor-pointer items-center justify-center'
      onClick={() => setCellValue(!cellValue)}
    >
      <DebuggerIcon variant={cellValue ? 'default' : 'muted'} />
    </div>
  )
}

export { SelectableClassCell, SelectableDebugCell, SelectableTypeCell }
