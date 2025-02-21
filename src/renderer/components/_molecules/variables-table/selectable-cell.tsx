import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon, DebuggerIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import type { PLCVariable } from '@root/types/PLC/open-plc'
import { baseTypeSchema } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { ArrayModal } from './elements/array-modal'

type ISelectableCellProps = CellContext<PLCVariable, unknown> & { selected?: boolean }

const SelectableTypeCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = false,
}: ISelectableCellProps) => {
  const {
    editor,
    project: {
      data: { dataTypes, pous },
    },
    libraries: sliceLibraries,
  } = useOpenPLCStore()

  const VariableTypes = [
    {
      definition: 'base-type',
      values: baseTypeSchema.options,
    },
    { definition: 'user-data-type', values: dataTypes.map((dataType) => dataType.name) },
  ]

  const LibraryTypes = [
    {
      definition: 'system',
      values: sliceLibraries.system
        .filter((library) =>
          pous.find((pou) => pou.data.name === editor.meta.name)?.type === 'function'
            ? library.pous.some((pou) => pou.type === 'function')
            : library.pous.some((pou) => pou),
        )
        .flatMap((library) => library.pous.map((pou) => pou.name.toUpperCase())),
    },
    {
      definition: 'user',
      values: sliceLibraries.user
        .filter((userLibrary) => {
          if (editor.type === 'plc-textual' || editor.type === 'plc-graphical') {
            if (editor.meta.pouType === 'program') {
              return (
                (userLibrary.type === 'function' || userLibrary.type === 'function-block') &&
                userLibrary.name !== editor.meta.name
              )
            } else if (editor.meta.pouType === 'function') {
              return userLibrary.type === 'function' && userLibrary.name !== editor.meta.name
            } else if (editor.meta.pouType === 'function-block') {
              return (
                (userLibrary.type === 'function' || userLibrary.type === 'function-block') &&
                userLibrary.name !== editor.meta.name
              )
            }
          }

          // Remove userLibrary if its name matches editor.meta.name (fallback case)
          return userLibrary.name !== editor.meta.name
        })
        .map((library) => library.name.toUpperCase()),
    },
  ]

  const pou = pous.find((pou) => pou.data.name === editor.meta.name)

  const { value, definition } = getValue<PLCVariable['type']>()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState<PLCVariable['type']['value']>(value)

  const [arrayModalIsOpen, setArrayModalIsOpen] = useState(false)
  const [poppoverIsOpen, setPoppoverIsOpen] = useState(false)
  const variableName = table.options.data[index].name

  // Filter the libraries to only include the ones that contain the variable
  const [inputFilter, setInputFilter] = useState('')
  const filteredSystemLibraries = LibraryTypes[0].values.filter((library) => library.includes(inputFilter))
  const filteredUserLibraries = LibraryTypes[1].values.filter((library) => library.includes(inputFilter))

  // When the input is blurred, we'll call our table meta's updateData function
  const onSelect = (definition: PLCVariable['type']['definition'], value: PLCVariable['type']['value']) => {
    // Todo: Must update the data in the store
    setCellValue(value)
    table.options.meta?.updateData(index, id, { definition, value })
  }

  // If the value is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(value)
  }, [value])

  return (
    <PrimitiveDropdown.Root onOpenChange={setPoppoverIsOpen} open={poppoverIsOpen}>
      <PrimitiveDropdown.Trigger
        asChild
        disabled={pou?.data.language !== 'st' && pou?.data.language !== 'il' && definition === 'derived'}
      >
        <div
          className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none', {
            'pointer-events-none': !selected,
            'cursor-default': !selected || definition === 'derived',
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
          {/** Basic types, that includes the base types and the types created by the user */}
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
                  className='box h-fit max-h-[300px] w-[200px] overflow-y-auto rounded-lg bg-white outline-none dark:bg-neutral-950'
                >
                  {scope.values.length > 0 ? (
                    <>
                      {scope.values.map((value) => (
                        <PrimitiveDropdown.Item
                          key={value}
                          onSelect={() => onSelect(scope.definition as PLCVariable['type']['definition'], value)}
                          className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                        >
                          <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                            {_.upperCase(value)}
                          </span>
                        </PrimitiveDropdown.Item>
                      ))}
                    </>
                  ) : (
                    <div className='flex h-8 w-full items-center justify-center py-1'>
                      <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                        No {_.startCase(scope.definition)} found
                      </span>
                    </div>
                  )}
                </PrimitiveDropdown.SubContent>
              </PrimitiveDropdown.Portal>
            </PrimitiveDropdown.Sub>
          ))}

          {/** Array type trigger */}
          <PrimitiveDropdown.Item asChild>
            <ArrayModal
              variableName={variableName}
              VariableRow={index}
              arrayModalIsOpen={arrayModalIsOpen}
              setArrayModalIsOpen={setArrayModalIsOpen}
              closeContainer={() => setPoppoverIsOpen(false)}
            />
          </PrimitiveDropdown.Item>

          {/** Library types */}
          {(pou?.data.language === 'st' || pou?.data.language === 'il') &&
            LibraryTypes.map((scope) => (
              <PrimitiveDropdown.Sub key={scope.definition} onOpenChange={() => setInputFilter('')}>
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
                    className='box h-fit max-h-[300px] w-[200px] overflow-y-auto rounded-lg bg-white outline-none dark:bg-neutral-950'
                  >
                    {scope.values.length > 0 ? (
                      <>
                        <div className='sticky top-0 z-10 bg-white p-2 dark:bg-neutral-950'>
                          <InputWithRef
                            type='text'
                            placeholder='Search...'
                            className='w-full rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'
                            value={inputFilter}
                            onChange={(e) => {
                              setInputFilter(e.target.value.toUpperCase())
                            }}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.stopPropagation()}
                          />
                        </div>
                        {scope === LibraryTypes[0]
                          ? filteredSystemLibraries.map((value) => (
                              <PrimitiveDropdown.Item
                                key={value}
                                onSelect={() => onSelect('derived', value)}
                                className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                              >
                                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                                  {_.upperCase(value)}
                                </span>
                              </PrimitiveDropdown.Item>
                            ))
                          : filteredUserLibraries.map((value) => (
                              <PrimitiveDropdown.Item
                                key={value}
                                onSelect={() => onSelect('derived', value)}
                                className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                              >
                                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                                  {_.upperCase(value)}
                                </span>
                              </PrimitiveDropdown.Item>
                            ))}
                      </>
                    ) : (
                      <div className='flex h-8 w-full items-center justify-center py-1'>
                        <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                          No {_.startCase(scope.definition)} libraries found
                        </span>
                      </div>
                    )}
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

const SelectableClassCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = true,
}: ISelectableCellProps) => {
  const initialValue = getValue()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const onValueChange = (value: string) => {
    // Todo: Must update the data in the store
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
          { 'pointer-events-none': !selected },
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
    <button className='flex h-full w-full cursor-pointer items-center justify-center' onClick={onClick}>
      <DebuggerIcon variant={cellValue ? 'default' : 'muted'} />
    </button>
  )
}

export { SelectableClassCell, SelectableDebugCell, SelectableTypeCell }
