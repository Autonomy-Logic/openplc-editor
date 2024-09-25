// import * as PrimitiveSwitch from '@radix-ui/react-switch'
import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '@root/renderer/store'
import { GlobalVariablesTableType } from '@root/renderer/store/slices'
import { PLCGlobalVariable } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useEffect, useState } from 'react'

import { TableActionButton } from '../../_atoms/buttons/tables-actions'
import { GlobalVariablesTable } from '../../_molecules/global-variables-table'

const GlobalVariablesEditor = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    workspace: {
      projectData: {
        configuration: {
          resource: { globalVariables },
        },
      },
    },
    editorActions: { updateModelVariables },
    workspaceActions: { createVariable, deleteVariable, rearrangeVariables },
  } = useOpenPLCStore()

  /**
   * Table data and column filters states to keep track of the table data and column filters
   */
  const [tableData, setTableData] = useState<PLCGlobalVariable[]>([])

  const [editorVariables, setEditorVariables] = useState<GlobalVariablesTableType>({
    display: 'table',
    selectedRow: ROWS_NOT_SELECTED.toString(),
    description: '',
  })

  /**
   * Update the table data and the editor's variables when the editor or the pous change
   */
  useEffect(() => {
    const variablesToTable = globalVariables.filter((variable) => variable.name)
    setTableData(variablesToTable)
  }, [editor, globalVariables])

  /**
   * If the editor name is not the same as the current editor name
   * set the editor name and the editor's variables to the states
   */
  useEffect(() => {
    if (editor.type === 'plc-resource')
      if (editor.variable.display === 'table') {
        const { description, display, selectedRow } = editor.variable
        setEditorVariables({
          display: display,
          selectedRow: selectedRow,
          description: description,
        })
      } else
        setEditorVariables({
          display: editor.variable.display,
        })
    console.log('table data ', tableData)
  }, [editor])

  const handleVisualizationTypeChange = (value: 'code' | 'table') => {
    updateModelVariables({
      display: value,
    })
  }

  const handleRearrangeVariables = (index: number, row?: number) => {
    if (editorVariables.display === 'code') return
    rearrangeVariables({
      scope: 'global',
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

    const variables = globalVariables.filter((variable) => variable.name)
    const selectedRow = parseInt(editorVariables.selectedRow)

    if (variables.length === 0) {
      createVariable({
        scope: 'global',
        data: {
          name: 'GlobalVar',
          type: { definition: 'base-type', value: 'dint' },
          class: 'global',
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

    const variable: PLCGlobalVariable =
      selectedRow === ROWS_NOT_SELECTED ? variables[variables.length - 1] : variables[selectedRow]

    if (selectedRow === ROWS_NOT_SELECTED) {
      createVariable({ scope: 'global', data: { ...variable } })
      updateModelVariables({
        display: 'table',
        selectedRow: variables.length,
      })
      return
    }
    createVariable({
      scope: 'global',
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
    deleteVariable({ scope: 'global', rowId: selectedRow })

    const variables = globalVariables.filter((variable) => variable.name)
    if (selectedRow === variables.length - 1) {
      updateModelVariables({
        display: 'table',
        selectedRow: selectedRow - 1,
      })
    }
  }

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelVariables({
      display: 'table',
      selectedRow: parseInt(row.id),
    })
  }

  return (
    <div aria-label='Variables editor container' className='flex  w-full flex-col gap-4'>
      <div aria-label='Variables editor actions' className='relative flex h-8 w-full min-w-[1035px]'>
        {editorVariables.display === 'table' ? (
          <div aria-label='Variables editor table actions container' className='flex h-full w-full justify-between'>
            <span className='select-none'>Global Variables</span>
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
        <div aria-label='Variables editor table container' className='' style={{ scrollbarGutter: 'stable' }}>
          <GlobalVariablesTable
            tableData={tableData}
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

export { GlobalVariablesEditor }
