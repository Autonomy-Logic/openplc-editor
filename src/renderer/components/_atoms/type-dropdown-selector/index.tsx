import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon } from '@root/renderer/assets'
import _ from 'lodash'
import { useState } from 'react'

import { InputWithRef } from '../input'

type TypeDropdownSelectorProps = {
  value: string
  onSelect: (definition: 'base-type' | 'user-data-type' | 'derived', value: string) => void
  variableTypes: { definition: string; values: string[] }[]
  libraryTypes: { definition: string; values: string[] }[]
  disabled?: boolean
}

export const TypeDropdownSelector = ({
  value,
  onSelect,
  variableTypes,
  libraryTypes,
  disabled = false,
}: TypeDropdownSelectorProps) => {
  const [inputFilter, setInputFilter] = useState('')
  const [poppoverIsOpen, setPoppoverIsOpen] = useState(false)

  const [variableFilters, setVariableFilters] = useState<Record<string, string>>({
    'base-type': '',
    'user-data-type': '',
  })

  const filteredSystemLibraries =
    libraryTypes
      .find((l) => l.definition === 'system')
      ?.values.filter((v) => v.toUpperCase().includes(inputFilter.toUpperCase())) || []

  const filteredUserLibraries =
    libraryTypes
      .find((l) => l.definition === 'user')
      ?.values.filter((v) => v.toUpperCase().includes(inputFilter.toUpperCase())) || []

  return (
    <PrimitiveDropdown.Root onOpenChange={setPoppoverIsOpen} open={poppoverIsOpen}>
      <PrimitiveDropdown.Trigger asChild disabled={disabled}>
        <div className='flex h-7 w-full max-w-44 cursor-pointer items-center justify-between rounded-lg border border-neutral-400 bg-white px-3 py-2 text-xs text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'>
          <span>{value ? _.upperCase(value) : 'Select...'}</span>
          <ArrowIcon size='sm' direction='down' />
        </div>
      </PrimitiveDropdown.Trigger>
      <PrimitiveDropdown.Portal>
        <PrimitiveDropdown.Content
          side='bottom'
          sideOffset={10}
          className='box z-50 h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
        >
          {variableTypes.map((scope) => {
            const filterText = variableFilters[scope.definition] || ''
            const filteredValues = scope.values.filter((v) => v.toUpperCase().includes(filterText.toUpperCase()))

            return (
              <PrimitiveDropdown.Sub
                key={scope.definition}
                onOpenChange={() => setVariableFilters((prev) => ({ ...prev, [scope.definition]: '' }))}
              >
                <PrimitiveDropdown.SubTrigger asChild className='z-50'>
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
                    className='box z-50 max-h-[300px] w-[200px] overflow-y-auto rounded-lg bg-white dark:bg-neutral-950'
                  >
                    <div className='sticky top-0 z-10 bg-white p-2 dark:bg-neutral-950'>
                      <InputWithRef
                        type='text'
                        placeholder='Search...'
                        className='w-full rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'
                        value={filterText}
                        onChange={(e) =>
                          setVariableFilters((prev) => ({
                            ...prev,
                            [scope.definition]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                    {filteredValues.length > 0 ? (
                      filteredValues.map((value) => (
                        <PrimitiveDropdown.Item
                          key={value}
                          onSelect={() => onSelect(scope.definition as 'base-type' | 'user-data-type', value)}
                          className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                        >
                          <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                            {_.upperCase(value)}
                          </span>
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
            )
          })}

          {libraryTypes.map((scope) => {
            const filteredValues = scope.definition === 'system' ? filteredSystemLibraries : filteredUserLibraries

            return (
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
                    className='box z-50 max-h-[300px] w-[200px] overflow-y-auto rounded-lg bg-white dark:bg-neutral-950'
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
                    {filteredValues.length > 0 ? (
                      filteredValues.map((value) => (
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
            )
          })}
        </PrimitiveDropdown.Content>
      </PrimitiveDropdown.Portal>
    </PrimitiveDropdown.Root>
  )
}
