import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { StructureTableType } from '@root/renderer/store/slices'
import { PLCStructureVariable } from '@root/types/PLC/open-plc'
import _ from 'lodash'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'

import { StructureTable } from './table'

type StructureDatatypeProps = ComponentPropsWithoutRef<'div'> & {
  data: PLCStructureVariable[]
}
const StructureDataType = ({ data, ...rest }: StructureDatatypeProps) => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    project: {
      data: { dataTypes },
    },
    editorActions: { updateModelStructure },
    projectActions: { _updateDatatype },
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
  }, [editor])

  useEffect(() => {
    const foundDataType = dataTypes.find((dataType) => dataType.derivation === 'structure')
    if (editor.type === 'plc-datatype' && foundDataType && 'variable' in foundDataType) {
      const { description, selectedRow } = editor.structure
      setEditorStructure({ description: description, selectedRow: selectedRow })
    }
  }, [editor])

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelStructure({
      selectedRow: parseInt(row.id),
    })
  }

  return (
    <div
      aria-label=' structure data type container'
      className='flex h-full w-full flex-1 flex-col gap-4 overflow-hidden bg-transparent'
      {...rest}
    >
      <div aria-label='Data type content actions container' className='flex h-8 w-full gap-8'>
        <div aria-label='Variables editor table actions container' className='flex h-full w-full justify-between'>
          <span className='select-none'>Structure</span>
          <div
            aria-label='Variables editor table actions container'
            className='flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
          >
            {/** This can be reviewed */}
            <TableActionButton aria-label='Add table row button' onClick={() => {}}>
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
