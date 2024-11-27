import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { StructureTableType } from '@root/renderer/store/slices'
import { PLCStructureVariable } from '@root/types/PLC/open-plc'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { StructureTable } from './table'

const StructureDataType = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    project: {
      data: { dataTypes },
    },
    editorActions: { updateModelStructure },
    projectActions: { updateDatatype },
  } = useOpenPLCStore()
  const [tableData, setTableData] = useState<PLCStructureVariable[]>([])

  const [editorStructure, setEditorStructure] = useState<StructureTableType>({
    selectedRow: ROWS_NOT_SELECTED.toString(),
    description: '',
  })

  useEffect(() => {
    const foundDataType = dataTypes.find((dataType) => dataType.derivation === 'structure')

    if (foundDataType && 'variable' in foundDataType) {
      setTableData(foundDataType.variable)
    }
  }, [dataTypes])

  useEffect(() => {
    const foundDataType = dataTypes.find((dataType) => dataType.derivation === 'structure')
    if (editor.type === 'plc-datatype' && foundDataType && 'variable' in foundDataType) {
      const { description, selectedRow } = editor.structure
      setEditorStructure({ description: description, selectedRow: selectedRow })
    }
  }, [editor])

  useEffect(() => {
    console.log('Editor Structure Updated:', editorStructure)
    console.log('Table Data:', tableData)
  }, [tableData, editorStructure])

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelStructure({
      selectedRow: parseInt(row.id),
    })
  }

  const handleCreateStructureVariable = () => {
    const structureVariables = tableData.filter((variable) => variable.name)
    const selectedRow = parseInt(editorStructure.selectedRow)

    if (structureVariables.length === 0) {
      updateDatatype(editor.meta.name, {
        derivation: 'structure',
        name: editor.meta.name,
        variable: [
          {
            name: '',
            type: { definition: 'base-type', value: 'dint' },
            initialValue: { simpleValue: { value: '' } },
          },
        ],
      })
      updateModelStructure({
        selectedRow: 0,
      })
      return
    }
    const structureVariable: PLCStructureVariable =
      selectedRow === ROWS_NOT_SELECTED
        ? structureVariables[structureVariables.length - 1]
        : structureVariables[selectedRow]

    if (selectedRow === ROWS_NOT_SELECTED) {
      updateDatatype(editor.meta.name, {
        derivation: 'structure',
        name: editor.meta.name,
        variable: [
          ...structureVariables,
          {
            name: '',
            initialValue: { simpleValue: { value: '' } },
            type:
              structureVariable.type.definition === 'derived'
                ? { definition: 'base-type', value: 'dint' }
                : structureVariable.type,
          },
        ],
      })
      updateModelStructure({
        selectedRow: structureVariables.length,
      })
    }
    updateDatatype(editor.meta.name, {
      derivation: 'structure',
      name: editor.meta.name,
      variable: [
        ...structureVariables,
        {
          name: '',
          initialValue: { simpleValue: { value: '' } },
          type:
            structureVariable.type.definition === 'derived'
              ? { definition: 'base-type', value: 'dint' }
              : structureVariable.type,
        },
      ],
    })
    updateModelStructure({
      selectedRow: selectedRow + 1,
    })
  }

  return (
    <div
      aria-label=' structure data type container'
      className='flex h-full w-full flex-1 flex-col gap-4 overflow-hidden bg-transparent'
    >
      <div aria-label='Data type content actions container' className='flex h-8 w-full gap-8'>
        <div aria-label='Variables editor table actions container' className='flex h-full w-full justify-between'>
          <span className='select-none'>Structure</span>
          <div
            aria-label='Variables editor table actions container'
            className='flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
          >
            {/** This can be reviewed */}
            <TableActionButton aria-label='Add table row button' onClick={() => handleCreateStructureVariable()}>
              <PlusIcon className='!stroke-brand' />
            </TableActionButton>
            <TableActionButton
              aria-label='Remove table row button'
              disabled={parseInt(editorStructure.selectedRow) === ROWS_NOT_SELECTED}
              onClick={() => {}}
            >
              <MinusIcon />
            </TableActionButton>
            <TableActionButton
              aria-label='Move table row up button'
              disabled={
                parseInt(editorStructure.selectedRow) === ROWS_NOT_SELECTED ||
                parseInt(editorStructure.selectedRow) === 0
              }
            >
              <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
            </TableActionButton>
            <TableActionButton
              aria-label='Move table row down button'
              disabled={
                parseInt(editorStructure.selectedRow) === ROWS_NOT_SELECTED ||
                parseInt(editorStructure.selectedRow) === tableData.length - 1
              }
            >
              <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
            </TableActionButton>
          </div>
        </div>
        <div aria-label='structure base type container' className='flex w-1/2 flex-col gap-3'></div>
        <div aria-label='structure initial value container' className='w-1/2'></div>
      </div>
      <StructureTable
        tableData={tableData}
        selectedRow={parseInt(editorStructure.selectedRow)}
        handleRowClick={handleRowClick}
      />
    </div>
  )
}

export { StructureDataType }
