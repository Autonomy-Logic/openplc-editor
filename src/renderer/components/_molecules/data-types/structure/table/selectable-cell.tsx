import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon } from '@root/renderer/assets'
import { InputWithRef } from '@root/renderer/components/_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import type { PLCStructureVariable } from '@root/types/PLC/open-plc'
import { baseTypeSchema } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { ArrayModal } from './elements/array-modal'

type ISelectableCellProps = CellContext<PLCStructureVariable, unknown> & { editable?: boolean }

const SelectableTypeCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const {
    editor,
    project: {
      data: { dataTypes },
    },
    libraries: sliceLibraries,
  } = useOpenPLCStore()

  const VariableTypes = [
    { definition: 'base-type', values: baseTypeSchema.options },
    { definition: 'user-data-type', values: dataTypes.map((dataType) => dataType.name) },
  ]

  const LibraryTypes = [
    {
      definition: 'system',
      values: sliceLibraries.system.flatMap((library) =>
        library.pous.filter((pou) => pou.type === 'function-block').map((pou) => pou.name.toUpperCase()),
      ),
    },
    {
      definition: 'user',
      values: sliceLibraries.user
        .filter((userLibrary) => userLibrary.name !== editor.meta.name)
        .flatMap((userLibrary) =>
          'pous' in userLibrary && Array.isArray((userLibrary as { pous: { type: string; name: string }[] }).pous)
            ? (userLibrary as { pous: { type: string; name: string }[] }).pous
                .filter((pou) => pou.type === 'function-block')
                .map((pou) => pou.name.toUpperCase())
            : userLibrary.type === 'function-block'
              ? [userLibrary.name.toUpperCase()]
              : [],
        ),
    },
  ]

  const { value, definition } = getValue<PLCStructureVariable['type']>()

  const [cellValue, setCellValue] = useState<PLCStructureVariable['type']['value']>(value)
  const [arrayModalIsOpen, setArrayModalIsOpen] = useState(false)
  const [poppoverIsOpen, setPoppoverIsOpen] = useState(false)
  const [variableFilters, setVariableFilters] = useState<Record<string, string>>({
    'base-type': '',
    'user-data-type': '',
  })
  const [inputFilter, setInputFilter] = useState('')

  const variableName = table.options.data[index].name

  const onSelect = (
    definition: PLCStructureVariable['type']['definition'],
    value: PLCStructureVariable['type']['value'],
  ) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, { definition, value })
  }

  useEffect(() => {
    setCellValue(value)
  }, [value])

  const filteredVariableValues = VariableTypes.map((scope) => ({
    definition: scope.definition,
    values: scope.values.filter((v) =>
      v.toUpperCase().includes((variableFilters[scope.definition] || '').toUpperCase()),
    ),
  }))

  const filteredLibraryValues = LibraryTypes.map((scope) => ({
    definition: scope.definition,
    values: scope.values.filter((v) => v.toUpperCase().includes(inputFilter.toUpperCase())),
  }))

  return (
    <PrimitiveDropdown.Root onOpenChange={setPoppoverIsOpen} open={poppoverIsOpen}>
      <PrimitiveDropdown.Trigger asChild disabled={!editable}>
        <div
          className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none', {
            'pointer-events-none': !editable,
            'cursor-default': !editable || definition === 'derived',
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
          {filteredVariableValues.map((scope) => (
            <PrimitiveDropdown.Sub
              key={scope.definition}
              onOpenChange={() => setVariableFilters((prev) => ({ ...prev, [scope.definition]: '' }))}
            >
              <PrimitiveDropdown.SubTrigger asChild>
                <div className='relative flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'>
                  <span className='text-xs text-neutral-700 dark:text-neutral-500'>
                    {_.startCase(scope.definition)}
                  </span>
                  <ArrowIcon size='md' direction='right' className='absolute right-1' />
                </div>
              </PrimitiveDropdown.SubTrigger>
              <PrimitiveDropdown.Portal>
                <PrimitiveDropdown.SubContent
                  sideOffset={5}
                  className='box max-h-[300px] w-[200px] overflow-y-auto rounded-lg bg-white dark:bg-neutral-950'
                >
                  <div className='sticky top-0 z-10 bg-white p-2 dark:bg-neutral-950'>
                    <InputWithRef
                      type='text'
                      placeholder='Search...'
                      className='w-full rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'
                      value={variableFilters[scope.definition]}
                      onChange={(e) =>
                        setVariableFilters((prev) => ({
                          ...prev,
                          [scope.definition]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  {scope.values.length > 0 ? (
                    scope.values.map((value) => (
                      <PrimitiveDropdown.Item
                        key={value}
                        onSelect={() => onSelect(scope.definition as PLCStructureVariable['type']['definition'], value)}
                        className='flex h-8 items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-900'
                      >
                        <span className='text-xs text-neutral-700 dark:text-neutral-500'>{_.upperCase(value)}</span>
                      </PrimitiveDropdown.Item>
                    ))
                  ) : (
                    <div className='flex h-8 items-center justify-center'>
                      <span className='text-xs text-neutral-700 dark:text-neutral-500'>
                        No {_.startCase(scope.definition)} found
                      </span>
                    </div>
                  )}
                </PrimitiveDropdown.SubContent>
              </PrimitiveDropdown.Portal>
            </PrimitiveDropdown.Sub>
          ))}

          {filteredLibraryValues.map((scope) => (
            <PrimitiveDropdown.Sub key={scope.definition} onOpenChange={() => setInputFilter('')}>
              <PrimitiveDropdown.SubTrigger asChild>
                <div className='relative flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'>
                  <span className='text-xs text-neutral-700 dark:text-neutral-500'>
                    {_.startCase(scope.definition)}
                  </span>
                  <ArrowIcon size='md' direction='right' className='absolute right-1' />
                </div>
              </PrimitiveDropdown.SubTrigger>
              <PrimitiveDropdown.Portal>
                <PrimitiveDropdown.SubContent
                  sideOffset={5}
                  className='box max-h-[300px] w-[200px] overflow-y-auto rounded-lg bg-white dark:bg-neutral-950'
                >
                  <div className='sticky top-0 z-10 bg-white p-2 dark:bg-neutral-950'>
                    <InputWithRef
                      type='text'
                      placeholder='Search...'
                      className='w-full rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'
                      value={inputFilter}
                      onChange={(e) => setInputFilter(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  {scope.values.length > 0 ? (
                    scope.values.map((value) => (
                      <PrimitiveDropdown.Item
                        key={value}
                        onSelect={() => onSelect('derived', value)}
                        className='flex h-8 items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-900'
                      >
                        <span className='text-xs text-neutral-700 dark:text-neutral-500'>{_.upperCase(value)}</span>
                      </PrimitiveDropdown.Item>
                    ))
                  ) : (
                    <div className='flex h-8 items-center justify-center'>
                      <span className='text-xs text-neutral-700 dark:text-neutral-500'>
                        No {_.startCase(scope.definition)} found
                      </span>
                    </div>
                  )}
                </PrimitiveDropdown.SubContent>
              </PrimitiveDropdown.Portal>
            </PrimitiveDropdown.Sub>
          ))}

          <PrimitiveDropdown.Item asChild>
            <ArrayModal
              variableName={variableName}
              VariableRow={index}
              arrayModalIsOpen={arrayModalIsOpen}
              setArrayModalIsOpen={setArrayModalIsOpen}
              closeContainer={() => setPoppoverIsOpen(false)}
            />
          </PrimitiveDropdown.Item>
        </PrimitiveDropdown.Content>
      </PrimitiveDropdown.Portal>
    </PrimitiveDropdown.Root>
  )
}

export { SelectableTypeCell }
