import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@root/renderer/components/_atoms'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCDataTypeDerivationSchema, PLCDataTypeStructureElement } from '@root/types/PLC/open-plc'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import { z } from 'zod'

const Structure = PLCDataTypeDerivationSchema.options[2]
type PLCDataTypeStructure = z.infer<typeof Structure>

const columnHelper = createColumnHelper<PLCDataTypeStructureElement>()
const columns = [
  columnHelper.accessor('id', {
    header: '#',
    size: 64,
    minSize: 32,
    maxSize: 64,
    enableResizing: true,
    cell: (props) => props.row.id,
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    enableResizing: true,
    size: 150,
    minSize: 150,
    maxSize: 300,
  }),
  columnHelper.accessor('type.value', {
    header: 'Type',
    enableResizing: true,
    size: 150,
    minSize: 150,
    maxSize: 300,
  }),
  columnHelper.accessor('initialValue', {
    header: 'Initial Value',
    enableResizing: true,
    size: 150,
    minSize: 150,
    maxSize: 300,
  }),
]

const StructureDataType = () => {
  const {
    project: {
      data: { dataTypes },
    },
  } = useOpenPLCStore()

  const [dataTypesState, setDataTypesState] = useState<PLCDataTypeStructure['elements']>([])

  useEffect(() => {
    const structureDataType = dataTypes.filter((dataType) => dataType.derivation.type === 'structure')
    structureDataType.forEach((dataType) => {
      if (dataType.derivation.type === 'structure') {
        setDataTypesState(dataType.derivation.elements)
      }
    })
  }, [dataTypes])

  useEffect(() => {
    console.log('structure data type', dataTypesState)
  }, [dataTypesState])

  const table = useReactTable({
    columns: columns,
    data: dataTypesState,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div aria-label='Struct data type container' className='flex h-full w-full flex-col gap-4 bg-transparent'>
      <div aria-label='Struct data type content actions container' className='flex flex-col gap-8'>
        <div
          aria-label='Struct data type table actions container'
          className='flex h-full w-full items-center justify-between'
        >
          <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
            Elements
          </p>
          <div
            aria-label='Data type table actions buttons container'
            className='flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
          >
            <TableActionButton aria-label='Add table row button' onClick={() => console.log('Button clicked')}>
              <PlusIcon className='!stroke-brand' />
            </TableActionButton>
            <TableActionButton aria-label='Remove table row button' onClick={() => console.log('Button clicked')}>
              <MinusIcon />
            </TableActionButton>
            <TableActionButton aria-label='Move table row up button' onClick={() => console.log('Button clicked')}>
              <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
            </TableActionButton>
            <TableActionButton aria-label='Move table row down button' onClick={() => console.log('Button clicked')}>
              <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
            </TableActionButton>
          </div>
        </div>
      </div>

      <Table context='Variables' className='mr-1'>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  resizable={header.column.columnDef.enableResizing}
                  isResizing={header.column.getIsResizing()}
                  resizeHandler={header.getResizeHandler()}
                  style={{
                    width: header.getSize(),
                    maxWidth: header.column.columnDef.maxSize,
                    minWidth: header.column.columnDef.minSize,
                  }}
                  key={header.id}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow id={row.id} key={row.id} className='h-8 cursor-pointer'>
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  style={{
                    width: cell.column.getSize(),
                    maxWidth: cell.column.columnDef.maxSize,
                    minWidth: cell.column.columnDef.minSize,
                  }}
                  key={cell.id}
                >
                  {flexRender(cell.column.columnDef.cell, {
                    ...cell.getContext(),
                  })}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export { StructureDataType }
