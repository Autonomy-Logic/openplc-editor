// import * as PrimitiveSwitch from '@radix-ui/react-switch'
import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCVariable } from '@root/types/PLC/test'
import { cn } from '@root/utils'
import { ColumnFiltersState } from '@tanstack/react-table'
import { useCallback, useEffect, useState } from 'react'

import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { VariablesTable } from '../../_molecules'

const VariablesEditor = () => {
  const {
    editor: {
      meta: { name },
    },
    projectData: { pous },
    workspaceActions: { createVariable, deleteVariable, rearrangeVariables },
  } = useOpenPLCStore()

  const ROWS_NOT_SELECTED = -1

  const [filterValue, setFilterValue] = useState('All')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [selectedRow, setSelectedRow] = useState<number>(ROWS_NOT_SELECTED)
  const [tableData, setTableData] = useState<PLCVariable[]>([])
  const [visualizationType, setVisualizationType] = useState<'code' | 'table'>('table')

  const FilterOptions = ['All', 'Local', 'Input', 'Output', 'InOut', 'External', 'Temp']

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

  const handleRearrangeVariables = (index: number, row?: number) => {
    rearrangeVariables({
      scope: 'local',
      associatedPou: name,
      rowId: row ?? selectedRow,
      newIndex: (row ?? selectedRow) + index,
    })
    setSelectedRow(selectedRow + index)
  }

  const handleCreateVariable = () => {
    const variables = pous.filter((pou) => pou.data.name === name)[0].data.variables

    if (variables.length === 0) {
      createVariable({
        scope: 'local',
        associatedPou: name,
        data: {
          name: 'new-variable',
          class: 'input',
          type: { definition: 'base-type', value: 'string' },
          location: '',
          documentation: '',
          debug: false,
        },
      })
      return
    }

    const regex = /-\d+$/
    const variable: PLCVariable =
      selectedRow === ROWS_NOT_SELECTED ? variables[variables.length - 1] : variables[selectedRow]

    const newName = variable.name.match(regex)
      ? variable.name.replace(regex, `-${parseInt(variable.name.match(regex)![0].slice(1)) + 1}`)
      : variable.name + '-1'
    const newVariable = {
      ...variable,
      name: newName,
    }

    if (selectedRow === ROWS_NOT_SELECTED) {
      createVariable({ scope: 'local', associatedPou: name, data: newVariable })
      setSelectedRow(variables.length)
      return
    }
    createVariable({
      scope: 'local',
      associatedPou: name,
      data: newVariable,
      rowToInsert: selectedRow + 1,
    })
    setSelectedRow(selectedRow + 1)
  }

  const handleRemoveVariable = () => {
    deleteVariable({ scope: 'local', associatedPou: name, rowId: selectedRow })

    const variables = pous.filter((pou) => pou.data.name === name)[0].data.variables
    if (selectedRow === variables.length - 1) {
      setSelectedRow(selectedRow - 1)
    }
  }

  const handleFilterChange = (value: string) => {
    setFilterValue(value)
    setColumnFilters((prev) =>
      value !== 'All'
        ? prev.filter((filter) => filter.id !== 'class').concat({ id: 'class', value: value.toLowerCase() })
        : prev.filter((filter) => filter.id !== 'class'),
    )
  }

  const handleRowClick = (row: HTMLTableRowElement) => {
    setSelectedRow(parseInt(row.id))
  }

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
            <Select value={filterValue} onValueChange={handleFilterChange}>
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
            <button
              aria-label='Add table row button'
              className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
              onClick={handleCreateVariable}
            >
              <PlusIcon className='!stroke-brand' />
            </button>
            <button
              aria-label='Remove table row button'
              className='hover:cursor-pointer hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-900'
              disabled={selectedRow === ROWS_NOT_SELECTED}
              onClick={handleRemoveVariable}
            >
              <MinusIcon />
            </button>
            <button
              aria-label='Move table row up button'
              className='hover:cursor-pointer hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-900'
              disabled={selectedRow === ROWS_NOT_SELECTED || selectedRow === 0}
              onClick={() => handleRearrangeVariables(-1)}
            >
              <StickArrowIcon direction='up' />
            </button>
            <button
              aria-label='Move table row down button'
              className='hover:cursor-pointer hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-900'
              disabled={selectedRow === ROWS_NOT_SELECTED || selectedRow === tableData.length - 1}
              onClick={() => handleRearrangeVariables(1)}
            >
              <StickArrowIcon direction='down' />
            </button>
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
      <div aria-label='Variables editor table container' className='h-full overflow-auto'>
        <VariablesTable
          tableData={tableData}
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          selectedRow={selectedRow}
          handleRowClick={handleRowClick}
        />
      </div>
    </div>
  )
}

export { VariablesEditor }
