import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { DebuggerIcon, MinusIcon, PencilIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import type { PLCVariable } from '@root/types/PLC/test'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { Button, Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle, ModalTrigger } from '../modal'
import { ArrayDimensionsComponent } from './elements/array'

type ISelectableCellProps = CellContext<PLCVariable, unknown> & { editable?: boolean }

const VariableTypes = [
  {
    definition: 'base-type',
    values: [
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
    values: ['userDt1', 'userDt2', 'userDt3'],
  },
]

const dimensions = ['1..0', '1..1', '1..2', '1..3', '1..4', '1..5', '1..6']

const SelectableTypeCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const { value } = getValue<PLCVariable['type']>()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState<PLCVariable['type']['value']>(value)

  const [arrayModalIsOpen, setArrayModalIsOpen] = useState(false)

  // When the input is blurred, we'll call our table meta's updateData function
  const onSelect = (definition: PLCVariable['type']['definition'], value: PLCVariable['type']['value']) => {
    // Todo: Must update the data in the store
    setCellValue(value)
    table.options.meta?.updateData(index, id, { definition, value })
  }

  console.log(arrayModalIsOpen)
  // If the value is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(value)
  }, [value])

  return (
    <PrimitiveDropdown.Root>
      <PrimitiveDropdown.Trigger asChild>
        <div
          className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none', {
            'pointer-events-none': !editable,
          })}
        >
          <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
            {cellValue === null ? '' : _.upperCase(cellValue as unknown as string)}
          </span>
        </div>
      </PrimitiveDropdown.Trigger>
      <PrimitiveDropdown.Portal>
        <PrimitiveDropdown.Content
          side='bottom'
          sideOffset={-20}
          className='h-fit w-[200px] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
        >
          {/** Basic types, that includes the base types and the types created by the user */}
          {VariableTypes.map((scope) => (
            <PrimitiveDropdown.Sub key={scope.definition}>
              <PrimitiveDropdown.SubTrigger asChild>
                <div className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'>
                  <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                    {_.startCase(scope.definition)}
                  </span>
                </div>
              </PrimitiveDropdown.SubTrigger>
              <PrimitiveDropdown.Portal>
                <PrimitiveDropdown.SubContent
                  sideOffset={5}
                  className='h-fit w-[200px] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                >
                  {scope.values.map((value) => (
                    <PrimitiveDropdown.Item
                      key={value}
                      onSelect={() =>
                        onSelect(
                          scope.definition as PLCVariable['type']['definition'],
                          value as PLCVariable['type']['value'],
                        )
                      }
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
          {/** Array type trigger */}
          <PrimitiveDropdown.Item asChild>
            <Modal onOpenChange={setArrayModalIsOpen} open={arrayModalIsOpen}>
              <ModalTrigger
                onClick={() => setArrayModalIsOpen(true)}
                className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'
              >
                <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>Array</span>
              </ModalTrigger>
              <ModalContent>
                <ModalHeader>
                  <ModalTitle>Array type definition</ModalTitle>
                </ModalHeader>
                <div
                  aria-label='Array type definition modal content container'
                  className='flex h-full w-full flex-col gap-2'
                >
                  <div aria-label='Header container' className='flex h-fit w-full flex-col gap-2'>
                    <div
                      aria-label='Array base type container'
                      className='flex h-fit w-full items-center justify-between'
                    >
                      <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
                        Base type
                      </label>
                      <Select aria-label='Array data type base type select'>
                        <SelectTrigger
                          withIndicator
                          placeholder='Base type'
                          className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
                        />
                        <SelectContent
                          position='popper'
                          side='bottom'
                          sideOffset={-28}
                          className='z-[999] h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg border border-brand-light bg-white shadow-card outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:shadow-dark-card'
                        >
                          <SelectItem
                            value='Option 1'
                            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                          >
                            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                              Option 1
                            </span>
                          </SelectItem>
                          <SelectItem
                            value='Option 2'
                            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                          >
                            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                              Option 2
                            </span>
                          </SelectItem>
                          <SelectItem
                            value='Option 3'
                            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                          >
                            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                              Option 3
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div
                      aria-label='Array type table actions container'
                      className='flex h-fit w-full items-center justify-between'
                    >
                      <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
                        Dimensions
                      </p>
                      <div
                        aria-label='Data type table actions buttons container'
                        className='flex h-full w-fit items-center justify-evenly *:rounded-md *:p-1'
                      >
                        <div
                          aria-label='Add table row button'
                          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                          onClick={() => console.log('Button clicked')}
                        >
                          <PencilIcon className='!stroke-brand' />
                        </div>
                        <div
                          aria-label='Add table row button'
                          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                          onClick={() => console.log('Button clicked')}
                        >
                          <PlusIcon className='!stroke-brand' />
                        </div>
                        <div
                          aria-label='Remove table row button'
                          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                          onClick={() => console.log('Button clicked')}
                        >
                          <MinusIcon />
                        </div>
                        <div
                          aria-label='Move table row up button'
                          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                          onClick={() => console.log('Button clicked')}
                        >
                          <StickArrowIcon direction='up' />
                        </div>
                        <div
                          aria-label='Move table row down button'
                          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                          onClick={() => console.log('Button clicked')}
                        >
                          <StickArrowIcon direction='down' />
                        </div>
                      </div>
                    </div>
                  </div>
                  <ArrayDimensionsComponent values={dimensions} />
                </div>
                <ModalFooter className='flex items-center justify-around'>
                  <Button className='h-8 justify-center text-xs' onClick={() => setArrayModalIsOpen(false)}>
                    Save
                  </Button>
                  <Button
                    onClick={() => setArrayModalIsOpen(false)}
                    className='h-8 justify-center bg-neutral-100 text-xs text-neutral-1000 hover:bg-neutral-300 focus:bg-neutral-200'
                  >
                    Cancel
                  </Button>
                </ModalFooter>
              </ModalContent>
            </Modal>
          </PrimitiveDropdown.Item>
        </PrimitiveDropdown.Content>
      </PrimitiveDropdown.Portal>
    </PrimitiveDropdown.Root>
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
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const onValueChange = (value: string) => {
    // Todo: Must update the data in the store
    console.log('teste', id, value)
    setCellValue(value)
    table.options.meta?.updateData(index, id, value)
  }

  // If the initialValue is changed external, sync it up with our state
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

const SelectableDebugCell = ({ getValue, row: { index }, column: { id }, table }: ISelectableCellProps) => {
  const initialValue = getValue<boolean>()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const onClick = () => {
    // Todo: Must update the data in the store
    setCellValue(!cellValue)
    table.options.meta?.updateData(index, id, !cellValue)
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <button
      className='flex h-full w-full cursor-pointer items-center justify-center'
      onClick={onClick}
    >
      <DebuggerIcon variant={cellValue ? 'default' : 'muted'} />
    </button>
  )
}

export { SelectableClassCell, SelectableDebugCell, SelectableTypeCell }
