import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { StructureTableType } from '@root/renderer/store/slices'
import { PLCStructureDatatype } from '@root/types/PLC/open-plc'
import _ from 'lodash'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'

import { StructureTable } from './table'

type StructureDatatypeProps = ComponentPropsWithoutRef<'div'> & {
  data: PLCStructureDatatype[]
}
const StructureDataType = ({ data, ...rest }: StructureDatatypeProps) => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    project: {
      data: { dataTypes },
    },
    editorActions: { updateModelStructure },
    projectActions: { createDatatype },
  } = useOpenPLCStore()
  const [tableData, setTableData] = useState<PLCStructureDatatype[]>([])

  const [editorStructure, setEditorStructure] = useState<StructureTableType>({
    selectedRow: ROWS_NOT_SELECTED.toString(),
    description: '',
  })

  useEffect(() => {
    const variablesToTable = data.filter((structure) => structure.derivation === 'structure')
    setTableData(variablesToTable)
  }, [editor, data])

  useEffect(() => {
    if (editor.type === 'plc-datatype' && editor.meta.derivation === 'structure') {
      const { description, selectedRow } = editor.structure
      setEditorStructure({
        selectedRow: selectedRow,
        description: description,
      })
    }
  }, [editor])

  // console.log('tableData', tableData)
  // console.log('data', data)
  // console.log('dataTypes', dataTypes)

  const handleCreateStructure = () => {
    const variables = dataTypes.filter(
      (dataType): dataType is PLCStructureDatatype => dataType.derivation === 'structure',
    )
    const selectedRow = parseInt(editorStructure.selectedRow)

    if (variables.length === 0) {
      createDatatype({
        data: {
          derivation: 'structure',
          name: 'structure',
          variable: [
            {
              name: 'structure0',
              type: { baseType: 'dint' },
            },
          ],
        },
      })

      return
    }

    const structureVariable: PLCStructureDatatype =
      selectedRow === ROWS_NOT_SELECTED ? variables[variables.length - 1] : variables[selectedRow]

    if (selectedRow === ROWS_NOT_SELECTED) {
      createDatatype({
        data: {
          derivation: 'structure',
          name: 'structure',
          variable: structureVariable.variable,
        },
      })
      updateModelStructure({
        selectedRow: selectedRow + 1,
      })
      return
    }
    createDatatype({
      data: {
        derivation: 'structure',
        name: 'structure',
        variable: structureVariable.variable,
      },
      rowToInsert: selectedRow + 1,
    })
    updateModelStructure({
      selectedRow: selectedRow + 1,
    })
  }

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelStructure({
      selectedRow: parseInt(row.id),
    })
  }

  // console.log('datatypes', dataTypes)

  return (
    <div
      aria-label=' structure data type container'
      className='flex h-full w-full flex-1 flex-col gap-4 overflow-hidden bg-transparent'
      {...rest}
    >
      <div aria-label='Data type content actions container' className='flex h-8 w-full gap-8'>
        <div aria-label='Variables editor table actions container' className='flex h-full w-full justify-between'>
          <span className='select-none'>Global Variables</span>
          <div
            aria-label='Variables editor table actions container'
            className='flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
          >
            {/** This can be reviewed */}
            <TableActionButton aria-label='Add table row button' onClick={handleCreateStructure}>
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
        tableData={data}
        selectedRow={parseInt(editorStructure.selectedRow)}
        handleRowClick={handleRowClick}
      />
    </div>
  )
}

export { StructureDataType }
