// import * as PrimitiveSwitch from '@radix-ui/react-switch'
import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '@root/renderer/store'
import { IVariable } from '@root/types/PLC'
import { cn } from '@root/utils'
import { useCallback, useEffect, useState } from 'react'

import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { VariablesTable } from '../../_molecules'

const VariablesEditor = () => {
  const {
    editor: { name },
    projectData: { pous },
  } = useOpenPLCStore()
  const [filterValue, setFilterValue] = useState('filter')
  const [tableData, setTableData] = useState<IVariable[]>([])
  const [visualizationType, setVisualizationType] = useState<'code' | 'table'>('table')

  const FilterOptions = ['local', 'input', 'output', 'inOut', 'external', 'temp']

  const onVisualizationTypeChange = useCallback(
    (value: 'code' | 'table') => {
      setVisualizationType(value)
    },
    [visualizationType],
  )

  useEffect(() => {
    const variablesToTable = pous.filter((pou) => pou.data.name === name)[0].data.variables
    setTableData(variablesToTable)
  }, [name, pous])

  return (
    <div aria-label='Variables editor container' className='flex h-full w-full flex-1 flex-col gap-4 overflow-auto'>
      <div aria-label='Variables editor actions' className='flex h-8 w-full min-w-[1035px]'>
        <div aria-label='Variables editor table actions container' className='flex h-full w-full justify-between'>
          <div
            aria-label='Variables editor table description container'
            className='flex h-full min-w-[425px] max-w-[40%] flex-1 items-center gap-2'
          >
            <label
              htmlFor='description'
              className='w-fit text-base font-medium text-neutral-1000 dark:text-neutral-300'
            >
              Description :
            </label>
            <InputWithRef
              id='description'
              className='h-full w-full max-w-80 rounded-lg border border-neutral-500 bg-inherit p-2 font-caption text-cp-sm font-normal text-neutral-850 focus:outline-none dark:border-neutral-850 dark:text-neutral-300'
            />
          </div>
          <div
            aria-label='Variables editor table class filter container'
            className='flex h-full min-w-[425px] max-w-[40%] flex-1 items-center gap-2'
          >
            <label
              htmlFor='class-filter'
              className='w-fit text-base font-medium text-neutral-1000 dark:text-neutral-300'
            >
              Class Filter :
            </label>
            <Select value={filterValue} onValueChange={(value) => setFilterValue(value)}>
              <SelectTrigger
                id='class-filter'
                placeholder={filterValue}
                withIndicator
                className='group flex h-full w-44 items-center justify-between rounded-lg border border-neutral-500 px-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-neutral-850 dark:text-neutral-300'
              />
              <SelectContent
                position='popper'
                sideOffset={3}
                align='center'
                className='h-fit w-40 overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
              >
                {FilterOptions.map((filter) => (
                  <SelectItem
                    key={filter}
                    value={filter}
                    className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  >
                    <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                      {filter}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            aria-label='Variables editor table actions container'
            className='flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
          >
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
        <div
          aria-label='Variables visualization switch container'
          className='flex h-fit w-full min-w-[60px] flex-1 items-center justify-center rounded-md'
        >
          <TableIcon
            aria-label='Variables table visualization'
            onClick={() => onVisualizationTypeChange('table')}
            size='md'
            currentVisible={visualizationType === 'table'}
            className={cn(
              visualizationType === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />

          <CodeIcon
            aria-label='Variables code visualization'
            onClick={() => onVisualizationTypeChange('code')}
            size='md'
            currentVisible={visualizationType === 'code'}
            className={cn(
              visualizationType === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>
      <VariablesTable tableData={tableData} />
    </div>
  )
}

export { VariablesEditor }
