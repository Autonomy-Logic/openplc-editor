// import * as PrimitiveSwitch from '@radix-ui/react-switch'
import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '@root/renderer/store'
import { EditorModel } from '@root/renderer/store/slices'
import { PLCVariable } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { ColumnFiltersState } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { VariablesTableButton } from '../../_atoms/buttons/variables-table'
import { VariablesTable } from '../../_molecules'

const VariablesEditor = () => {
  const {
    editor,
    workspace: {
      projectData: { pous },
    },
    editorActions: { updateModelVariables },
    workspaceActions: { createVariable, deleteVariable, rearrangeVariables },
  } = useOpenPLCStore()

  const ROWS_NOT_SELECTED = -1

  const [tableData, setTableData] = useState<PLCVariable[]>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const [visualizationType, setVisualizationType] = useState<'code' | 'table'>('table')
  const [selectedRow, setSelectedRow] = useState<number>(ROWS_NOT_SELECTED)
  const [filterValue, setFilterValue] = useState('All')

  const [editorConfig, setEditorConfig] = useState<EditorModel | null>(null)

  const FilterOptions = ['All', 'Local', 'Input', 'Output', 'InOut', 'External', 'Temp']

  useEffect(() => {
    const variablesToTable = pous.filter((pou) => pou.data.name === editor.meta.name)[0].data.variables
    setTableData(variablesToTable)

    console.log('editor', editor)
    console.log('editorConfig', editorConfig)
    console.log('editor.name !== editorConfig.name', editor.meta.name !== editorConfig?.meta.name)
    if (!editorConfig || editorConfig.meta.name !== editor.meta.name) {
      setEditorConfig(editor)
      if (editor.type === 'plc-textual' || editor.type === 'plc-graphical') {
        const { variable } = editor
        if (variable.display === 'table') {
          setSelectedRow(parseInt(variable.selectedRow))
          setFilterValue(variable.classFilter)
          setColumnFilters((prev) =>
            variable.classFilter !== 'All'
              ? prev
                  .filter((filter) => filter.id !== 'class')
                  .concat({ id: 'class', value: variable.classFilter.toLowerCase() })
              : prev.filter((filter) => filter.id !== 'class'),
          )
        }
        setVisualizationType(variable.display)
      }
    }
  }, [editor, pous])

  useEffect(() => {
    console.log('newEditorConfig', editorConfig)
  }, [editorConfig])

  const handleVisualizationTypeChange = (value: 'code' | 'table') => {
    setVisualizationType(value)
    updateModelVariables(editor.meta.name, {
      display: value,
      selectedRow: selectedRow.toString(),
      classFilter: filterValue as 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp',
      description: '',
    })
  }

  const handleRearrangeVariables = (index: number, row?: number) => {
    rearrangeVariables({
      scope: 'local',
      associatedPou: editor.meta.name,
      rowId: row ?? selectedRow,
      newIndex: (row ?? selectedRow) + index,
    })
    setSelectedRow(selectedRow + index)
    updateModelVariables(editor.meta.name, {
      display: visualizationType,
      selectedRow: (selectedRow + index).toString(),
      classFilter: filterValue as 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp',
      description: '',
    })
  }

  const handleCreateVariable = () => {
    const variables = pous.filter((pou) => pou.data.name === editor.meta.name)[0].data.variables

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
      setSelectedRow(0)
      updateModelVariables(editor.meta.name, {
        display: visualizationType,
        selectedRow: '0',
        classFilter: filterValue as 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp',
        description: '',
      })
      return
    }

    const variable: PLCVariable =
      selectedRow === ROWS_NOT_SELECTED ? variables[variables.length - 1] : variables[selectedRow]

    if (selectedRow === ROWS_NOT_SELECTED) {
      createVariable({ scope: 'local', associatedPou: editor.meta.name, data: { ...variable } })
      setSelectedRow(variables.length)
      updateModelVariables(editor.meta.name, {
        display: visualizationType,
        selectedRow: variables.length.toString(),
        classFilter: filterValue as 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp',
        description: '',
      })
      return
    }
    createVariable({
      scope: 'local',
      associatedPou: editor.meta.name,
      data: { ...variable },
      rowToInsert: selectedRow + 1,
    })
    setSelectedRow(selectedRow + 1)
    updateModelVariables(editor.meta.name, {
      display: visualizationType,
      selectedRow: (selectedRow + 1).toString(),
      classFilter: filterValue as 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp',
      description: '',
    })
  }

  const handleRemoveVariable = () => {
    deleteVariable({ scope: 'local', associatedPou: editor.meta.name, rowId: selectedRow })

    const variables = pous.filter((pou) => pou.data.name === editor.meta.name)[0].data.variables
    if (selectedRow === variables.length - 1) {
      setSelectedRow(selectedRow - 1)
      updateModelVariables(editor.meta.name, {
        display: visualizationType,
        selectedRow: (selectedRow - 1).toString(),
        classFilter: filterValue as 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp',
        description: '',
      })
    }
  }

  const handleFilterChange = (value: string) => {
    setFilterValue(value)
    setColumnFilters((prev) =>
      value !== 'All'
        ? prev.filter((filter) => filter.id !== 'class').concat({ id: 'class', value: value.toLowerCase() })
        : prev.filter((filter) => filter.id !== 'class'),
    )
    updateModelVariables(editor.meta.name, {
      display: visualizationType,
      selectedRow: (selectedRow - 1).toString(),
      classFilter: value as 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp',
      description: '',
    })
  }

  const handleRowClick = (row: HTMLTableRowElement) => {
    setSelectedRow(parseInt(row.id))
    updateModelVariables(editor.meta.name, {
      display: visualizationType,
      selectedRow: row.id,
      classFilter: filterValue as 'All' | 'Local' | 'Input' | 'Output' | 'InOut' | 'External' | 'Temp',
      description: '',
    })
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
            <VariablesTableButton aria-label='Add table row button' onClick={handleCreateVariable}>
              <PlusIcon className='!stroke-brand' />
            </VariablesTableButton>
            <VariablesTableButton
              aria-label='Remove table row button'
              disabled={selectedRow === ROWS_NOT_SELECTED}
              onClick={handleRemoveVariable}
            >
              <MinusIcon />
            </VariablesTableButton>
            <VariablesTableButton
              aria-label='Move table row up button'
              disabled={selectedRow === ROWS_NOT_SELECTED || selectedRow === 0}
              onClick={() => handleRearrangeVariables(-1)}
            >
              <StickArrowIcon direction='up' />
            </VariablesTableButton>
            <VariablesTableButton
              aria-label='Move table row down button'
              disabled={selectedRow === ROWS_NOT_SELECTED || selectedRow === tableData.length - 1}
              onClick={() => handleRearrangeVariables(1)}
            >
              <StickArrowIcon direction='down' />
            </VariablesTableButton>
          </div>
        </div>
        <div
          aria-label='Variables visualization switch container'
          className='flex h-fit w-full min-w-[60px] flex-1 items-center justify-center rounded-md'
        >
          <TableIcon
            aria-label='Variables table visualization'
            onClick={() => handleVisualizationTypeChange('table')}
            size='md'
            currentVisible={visualizationType === 'table'}
            className={cn(
              visualizationType === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />

          <CodeIcon
            aria-label='Variables code visualization'
            onClick={() => handleVisualizationTypeChange('code')}
            size='md'
            currentVisible={visualizationType === 'code'}
            className={cn(
              visualizationType === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>
      <div
        aria-label='Variables editor table container'
        className='h-full overflow-y-auto'
        style={{ scrollbarGutter: 'stable' }}
      >
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
