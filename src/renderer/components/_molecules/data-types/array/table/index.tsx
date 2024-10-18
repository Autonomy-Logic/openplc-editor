import { Table, TableBody, TableCell, TableRow } from '@components/_atoms'
import { MinusIcon, PlusIcon } from '@radix-ui/react-icons'
import { StickArrowIcon } from '@root/renderer/assets'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCArrayDatatype, PLCDataType } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils/cn'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'
import React from 'react'

import { DimensionCell } from './editable-cell'

type DataTypeDimensionsTableProps = {
  name: string
  dimensions: PLCArrayDatatype['dimensions']
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const DimensionsTable = ({ name, dimensions, selectedRow, handleRowClick }: DataTypeDimensionsTableProps) => {
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const tableBodyRowRef = useRef<HTMLTableRowElement>(null)
  const [tableData, setTableData] = useState<PLCArrayDatatype['dimensions']>(dimensions)

  const {
    workspaceActions: { updateDatatype },
    workspace: {
      projectData: { _dataTypes },
    },
  } = useOpenPLCStore()

  const columnHelper = createColumnHelper<{ dimension: unknown }>()
  const columns = React.useMemo(
    () => [
      columnHelper.accessor('dimension', {
        size: 900,
        minSize: 350,
        maxSize: 900,
        enableResizing: true,
        cell: (cellProps) => (
          <DimensionCell
            onInputChange={(value) => handleInputChange(value, cellProps.row.index)}
            onBlur={() => handleBlur(cellProps.row.index)}
            id={`dimension-input-${cellProps.row.index}`}
            autoFocus={cellProps.row.index === focusIndex}
            name={name}
            dimensions={dimensions}
            selectedRow={selectedRow}
            handleRowClick={handleRowClick}
            {...cellProps}
          />
        ),
      }),
    ],
    [focusIndex, handleRowClick],
  )

  useEffect(() => {
    if (focusIndex !== null) {
      const inputElement = document.getElementById(`dimension-input-${focusIndex}`)
      if (inputElement) {
        inputElement.focus()
      }
    }
  }, [focusIndex])

  useEffect(() => {
    setFocusIndex(selectedRow)
  }, [selectedRow])

  const handleInputChange = (value: string, index: number) => {
    setTableData((prevRows) => prevRows.map((row, i) => (i === index ? { ...row, dimension: value } : row)))
    setFocusIndex(index)
  }

  const handleBlur = (rowIndex: number) => {
    setTableData((prevRows) => {
      const inputElement = document.getElementById(`dimension-input-${rowIndex}`) as HTMLInputElement;
      if (inputElement && inputElement.value?.trim() === '') {
        const newRows = prevRows.filter((_, index) => index !== rowIndex);
        setFocusIndex(null);
        return newRows;
      } else if (inputElement && inputElement.value?.trim() !== '') {
        const inputValue = inputElement.value?.trim();
        const optionalSchema = {
          name: name,
          dimensions: prevRows.map((row, index) => ({ dimension: index === rowIndex ? inputValue : row.dimension })),
        };
        updateDatatype(name, optionalSchema as PLCDataType);
  
        return prevRows.map((row, i) =>
          i === rowIndex
            ? { ...row, dimension: inputValue }
            : row
        );
      }
      return prevRows;
    });
  }
  const addNewRow = () => {
    setTableData((prevRows) => {
      const newRows = [...prevRows, { dimension: '' }]
      setFocusIndex(newRows?.length - 1)
      return newRows
    })
  }

  const removeRow = () => {
   setTableData((prevRows) => {
    if (selectedRow !== null) {
      const newRows = prevRows.filter((_, index) => index !== selectedRow);

      newRows.forEach(() => {
        const optionalSchema = {
          dimensions: newRows.map(row => ({ dimension: row.dimension })),
        };
        updateDatatype(name, optionalSchema as PLCArrayDatatype);
      });
      prevRows = newRows;
    }
    return prevRows;
  });
  };

  const moveRowUp = () => {
    setTableData((prevRows) => {
      if (selectedRow !== null && selectedRow > 0) {
        const newRows = [...prevRows];
        const temp = newRows[selectedRow];
        newRows[selectedRow] = newRows[selectedRow - 1];
        newRows[selectedRow - 1] = temp;
        setFocusIndex(selectedRow - 1);
  
        newRows.forEach(() => {
          const optionalSchema = {
            dimensions: newRows.map(row => ({ dimension: row.dimension })),
          };
          updateDatatype(name, optionalSchema as PLCArrayDatatype);
        });
  
  
        prevRows = newRows;
      }
      return prevRows;
    });
  };

  const moveRowDown = () => {
    setTableData((prevRows) => {
      if (selectedRow !== null && selectedRow < prevRows.length - 1) {
        const newRows = [...prevRows]
        const temp = newRows[selectedRow]
        newRows[selectedRow] = newRows[selectedRow + 1]
        newRows[selectedRow + 1] = temp
        setFocusIndex(selectedRow + 1)

        newRows.forEach(() => {
          const optionalSchema = {
            dimensions: newRows.map(row => ({ dimension: row.dimension })),
          };
          updateDatatype(name, optionalSchema as PLCArrayDatatype);
        });

        prevRows = newRows
      }
      return prevRows
    })
  }

  const resetBorders = () => {
    const parent = tableBodyRef.current
    if (!parent?.children) return

    const rows = Array.from(parent.children)
    rows.forEach((row) => {
      row.className = cn(
        row.className,
        '[&:last-child>td]:border-b-neutral-500 [&>td:first-child]:border-l-neutral-500 [&>td:last-child]:border-r-neutral-500 [&>td]:border-b-neutral-300',
        '[&>td]:border-t-neutral-500',
        'dark:[&>td:first-child]:border-l-neutral-500 dark:[&>td:last-child]:border-r-neutral-500 dark:[&>td]:border-b-neutral-800',
        'dark:[&>td]:border-t-neutral-500',
        'shadow-none dark:shadow-none',
      )
    })
  }

  const setBorders = () => {
    const row = tableBodyRowRef.current
    const parent = tableBodyRef.current
    if (!row || !parent) return

    const element = row?.previousElementSibling

    if (element) {
      element.className = cn(
        element.className,
        '[&>td]:border-b-brand dark:[&>td]:border-b-brand',
        '[&>th]:border-b-brand dark:[&>th]:border-b-brand',
      )
    }
    row.className = cn(
      row.className,
      '[&:last-child>td]:border-b-brand [&>td:first-child]:border-l-brand [&>td:last-child]:border-r-brand [&>td]:border-b-brand',
      '[&>td]:border-t-brand',
      'dark:[&>td:first-child]:border-l-brand dark:[&>td:last-child]:border-r-brand dark:[&>td]:border-b-brand',
      'dark:[&>td]:border-t-brand',
    )
  }

  useEffect(() => {
    resetBorders()
    setBorders()
  }, [selectedRow])

  const table = useReactTable({
    columns: columns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  })

  return (
    <>
      <div
        aria-label='Array data type table actions container'
        className='flex h-fit w-3/5 items-center justify-between'
      >
        <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
          Dimensions
        </p>
        <div
          aria-label='Data type table actions buttons container'
          className='flex-start flex h-full w-2/5 *:rounded-md *:p-1'
        >
          <TableActionButton aria-label='Add table row button' onClick={addNewRow} id='add-new-row-button'>
            <PlusIcon className='!stroke-brand' />
          </TableActionButton>
          <TableActionButton aria-label='Remove table row button' onClick={removeRow}>
            <MinusIcon />
          </TableActionButton>
          <TableActionButton aria-label='Move table row up button' onClick={moveRowUp}>
            <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
          </TableActionButton>
          <TableActionButton aria-label='Move table row down button' onClick={moveRowDown}>
            <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
          </TableActionButton>
        </div>
      </div>
      <Table context='data-type-array'>
        <TableBody ref={tableBodyRef}>
          {table.getRowModel().rows.map((row, index) => (
            <TableRow
              id={`${index}`}
              key={index}
              className='h-8'
              selected={selectedRow === index}
              ref={selectedRow === index ? tableBodyRowRef : null}
              onClick={(e) => handleRowClick(e.currentTarget)}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  style={{ maxWidth: cell.column.columnDef.maxSize, minWidth: cell.column.columnDef.minSize }}
                  key={cell.id}
                >
                  {flexRender(cell.column.columnDef.cell, {
                    ...cell.getContext(),
                    editable: selectedRow === index,
                  })}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}

export { DimensionsTable }
