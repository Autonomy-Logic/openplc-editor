// import * as PrimitiveSwitch from '@radix-ui/react-switch'
import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '@root/renderer/store'
import { VariablesTable as VariablesTableType } from '@root/renderer/store/slices'
import { PLCVariable } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { ColumnFiltersState } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { TableActionButton } from '../../_atoms/buttons/tables-actions'
import { VariablesTable } from '../../_molecules'

const VariablesEditor = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    workspace: {
      projectData: { pous },
    },
    editorActions: { updateModelVariables },
    workspaceActions: { createVariable, deleteVariable, rearrangeVariables },
  } = useOpenPLCStore()

  /**
   * Table data and column filters states to keep track of the table data and column filters
   */
  const [tableData, setTableData] = useState<PLCVariable[]>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  /**
   * Editor name state to keep track of the editor name
   * Other states to keep track of the editor's variables and display at the screen
   */
  const FilterOptions = ['All', 'Local', 'Input', 'Output', 'InOut', 'External', 'Temp'] as const
  type FilterOptionsType = (typeof FilterOptions)[number]
  const [editorVariables, setEditorVariables] = useState<VariablesTableType>({
    display: 'table',
    selectedRow: ROWS_NOT_SELECTED.toString(),
    classFilter: 'All',
    description: '',
  })

  /**
   * Update the table data and the editor's variables when the editor or the pous change
   */
  useEffect(() => {
    const variablesToTable = pous.filter((pou) => pou.data.name === editor.meta.name)[0].data.variables
    setTableData(variablesToTable)
  }, [editor, pous])

  /**
   * If the editor name is not the same as the current editor name
   * set the editor name and the editor's variables to the states
   */
  useEffect(() => {
    if (editor.type === 'plc-textual' || editor.type === 'plc-graphical')
      if (editor.variable.display === 'table') {
        const { classFilter, description, display, selectedRow } = editor.variable
        setEditorVariables({
          display: display,
          selectedRow: selectedRow,
          classFilter: classFilter,
          description: description,
        })
        setColumnFilters((prev) =>
          classFilter !== 'All'
            ? prev.filter((filter) => filter.id !== 'class').concat({ id: 'class', value: classFilter.toLowerCase() })
            : prev.filter((filter) => filter.id !== 'class'),
        )
      } else
        setEditorVariables({
          display: editor.variable.display,
        })

  }, [editor])

  const handleVisualizationTypeChange = (value: 'code' | 'table') => {
    updateModelVariables({
      display: value,
    })
  }

  const handleRearrangeVariables = (index: number, row?: number) => {
    if (editorVariables.display === 'code') return
    rearrangeVariables({
      scope: 'local',
      associatedPou: editor.meta.name,
      rowId: row ?? parseInt(editorVariables.selectedRow),
      newIndex: (row ?? parseInt(editorVariables.selectedRow)) + index,
    })
    updateModelVariables({
      display: 'table',
      selectedRow: parseInt(editorVariables.selectedRow) + index,
    })
  }

  const handleCreateVariable = () => {
    if (editorVariables.display === 'code') return

    const variables = pous.filter((pou) => pou.data.name === editor.meta.name)[0].data.variables
    const selectedRow = parseInt(editorVariables.selectedRow)

    if (variables.length === 0) {
      createVariable({
        scope: 'local',
        associatedPou: editor.meta.name,
        data: {
          name: 'LocalVar',
          class: 'local',
          type: { definition: 'base-type', value: 'dint' },
          location: '',
          documentation: '',
          debug: false,
        },
      })
      updateModelVariables({
        display: 'table',
        selectedRow: 0,
      })
      return
    }

    const variable: PLCVariable =
      selectedRow === ROWS_NOT_SELECTED ? variables[variables.length - 1] : variables[selectedRow]

    if (selectedRow === ROWS_NOT_SELECTED) {
      createVariable({ scope: 'local', associatedPou: editor.meta.name, data: { ...variable } })
      updateModelVariables({
        display: 'table',
        selectedRow: variables.length,
      })
      return
    }
    createVariable({
      scope: 'local',
      associatedPou: editor.meta.name,
      data: { ...variable },
      rowToInsert: selectedRow + 1,
    })
    updateModelVariables({
      display: 'table',
      selectedRow: selectedRow + 1,
    })
  }

  const handleRemoveVariable = () => {
    if (editorVariables.display === 'code') return

    const selectedRow = parseInt(editorVariables.selectedRow)
    deleteVariable({ scope: 'local', associatedPou: editor.meta.name, rowId: selectedRow })

    const variables = pous.filter((pou) => pou.data.name === editor.meta.name)[0].data.variables
    if (selectedRow === variables.length - 1) {
      updateModelVariables({
        display: 'table',
        selectedRow: selectedRow - 1,
      })
    }
  }

  const handleFilterChange = (value: FilterOptionsType) => {
    setColumnFilters((prev) =>
      value !== 'All'
        ? prev.filter((filter) => filter.id !== 'class').concat({ id: 'class', value: value.toLowerCase() })
        : prev.filter((filter) => filter.id !== 'class'),
    )
    updateModelVariables({
      display: 'table',
      classFilter: value,
    })
  }

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelVariables({
      display: 'table',
      selectedRow: parseInt(row.id),
    })
  }

  return (
    <div aria-label='Variables editor container' className='flex h-full w-full flex-1 flex-col gap-4 overflow-auto'>
      <div aria-label='Variables editor actions' className='relative flex h-8 w-full min-w-[1035px]'>
        {editorVariables.display === 'table' ? (
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
                className='h-full w-full max-w-80 rounded-lg border border-neutral-500 bg-inherit p-2 font-caption text-cp-sm font-normal text-neutral-850 focus:border-brand focus:outline-none dark:border-neutral-850 dark:text-neutral-300'
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
              <Select value={editorVariables.classFilter} onValueChange={handleFilterChange}>
                <SelectTrigger
                  id='class-filter'
                  placeholder={editorVariables.classFilter}
                  withIndicator
                  className='group flex h-full w-44 items-center justify-between rounded-lg border border-neutral-500 px-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-neutral-850 dark:text-neutral-300'
                />
                <SelectContent
                  position='popper'
                  sideOffset={3}
                  align='center'
                  className='box h-fit w-40 overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
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
              {/** This can be reviewed */}
              <TableActionButton aria-label='Add table row button' onClick={handleCreateVariable}>
                <PlusIcon className='!stroke-brand' />
              </TableActionButton>
              <TableActionButton
                aria-label='Remove table row button'
                disabled={parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED}
                onClick={handleRemoveVariable}
              >
                <MinusIcon />
              </TableActionButton>
              <TableActionButton
                aria-label='Move table row up button'
                disabled={
                  parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                  parseInt(editorVariables.selectedRow) === 0
                }
                onClick={() => handleRearrangeVariables(-1)}
              >
                <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
              </TableActionButton>
              <TableActionButton
                aria-label='Move table row down button'
                disabled={
                  parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                  parseInt(editorVariables.selectedRow) === tableData.length - 1
                }
                onClick={() => handleRearrangeVariables(1)}
              >
                <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
              </TableActionButton>
            </div>
          </div>
        ) : (
          <></>
        )}
        <div
          aria-label='Variables visualization switch container'
          className={cn('flex h-fit w-fit flex-1 items-center justify-center rounded-md', {
            'absolute right-0': editorVariables.display === 'code',
          })}
        >
          <TableIcon
            aria-label='Variables table visualization'
            onClick={() => handleVisualizationTypeChange('table')}
            size='md'
            currentVisible={editorVariables.display === 'table'}
            className={cn(
              editorVariables.display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />

          <CodeIcon
            aria-label='Variables code visualization'
            onClick={() => handleVisualizationTypeChange('code')}
            size='md'
            currentVisible={editorVariables.display === 'code'}
            className={cn(
              editorVariables.display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>
      {editorVariables.display === 'table' ? (
        <div
          aria-label='Variables editor table container'
          className='h-full overflow-y-auto'
          style={{ scrollbarGutter: 'stable' }}
        >
          <VariablesTable
            tableData={tableData}
            filterValue={editorVariables.classFilter.toLowerCase()}
            columnFilters={columnFilters}
            setColumnFilters={setColumnFilters}
            selectedRow={parseInt(editorVariables.selectedRow)}
            handleRowClick={handleRowClick}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  )
}

export { VariablesEditor }
