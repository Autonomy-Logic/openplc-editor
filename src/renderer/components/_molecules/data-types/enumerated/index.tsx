import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import TableActions from '@root/renderer/components/_atoms/table-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCEnumeratedDatatype } from '@root/types/PLC/open-plc'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'

import { EnumeratedTable } from './table'

type EnumDatatypeProps = ComponentPropsWithoutRef<'div'> & {
  data: PLCEnumeratedDatatype
}
const EnumeratorDataType = ({ data, ...rest }: EnumDatatypeProps) => {
  const {
    editor,
    projectActions: { updateDatatype },
    snapshotActions: { addSnapshot },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const ROWS_NOT_SELECTED = -1

  const [arrayTable, setArrayTable] = useState<{ selectedRow: number }>({ selectedRow: ROWS_NOT_SELECTED })
  const [initialValueData, setInitialValueData] = useState<string>('')

  const [tableData, setTableData] = useState<PLCEnumeratedDatatype['values']>([])

  useEffect(() => {
    setInitialValueData(data.initialValue || '')
  }, [])

  useEffect(() => {
    setTableData(data.values)
  }, [data.values])

  const handleInitialValueChange = (value: string) => {
    setInitialValueData(value)
    addSnapshot(editor.meta.name)
    updateDatatype(data.name, {
      ...data,
      initialValue: value,
    })
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const addNewRow = () => {
    addSnapshot(editor.meta.name)

    setTableData((prevRows) => {
      const newRows = [...prevRows, { description: '' }]
      setArrayTable({ selectedRow: newRows.length - 1 })
      updateDatatype(data.name, {
        values: newRows.map((row) => ({ description: row?.description })),
        initialValue: data.initialValue,
      } as PLCEnumeratedDatatype)
      handleFileAndWorkspaceSavedState(editor.meta.name)

      return newRows
    })
  }

  const removeRow = () => {
    addSnapshot(editor.meta.name)

    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null) {
        const newRows = prevRows.filter((_, index) => index !== arrayTable.selectedRow)

        const newFocusIndex = arrayTable.selectedRow === newRows.length ? newRows.length - 1 : arrayTable.selectedRow
        setArrayTable({ selectedRow: newFocusIndex })

        updateDatatype(data.name, {
          values: newRows.map((row) => ({ description: row?.description })),
          initialValue: data.initialValue,
        } as PLCEnumeratedDatatype)
        handleFileAndWorkspaceSavedState(editor.meta.name)

        return newRows
      }
      return prevRows
    })
  }

  const moveRowUp = () => {
    addSnapshot(editor.meta.name)

    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null && arrayTable.selectedRow > 0) {
        const newRows = [...prevRows]
        const temp = newRows[arrayTable.selectedRow]
        newRows[arrayTable.selectedRow] = newRows[arrayTable.selectedRow - 1]
        newRows[arrayTable.selectedRow - 1] = temp

        const newFocusIndex = arrayTable.selectedRow - 1
        setArrayTable({ selectedRow: newFocusIndex })

        updateDatatype(data.name, {
          values: newRows.map((row) => ({ description: row?.description })),
          initialValue: data.initialValue,
        } as PLCEnumeratedDatatype)
        handleFileAndWorkspaceSavedState(editor.meta.name)

        prevRows = newRows
      }
      return prevRows
    })
  }

  const moveRowDown = () => {
    addSnapshot(editor.meta.name)

    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null && arrayTable.selectedRow < prevRows.length - 1) {
        const newRows = [...prevRows]
        const temp = newRows[arrayTable.selectedRow]
        newRows[arrayTable.selectedRow] = newRows[arrayTable.selectedRow + 1]
        newRows[arrayTable.selectedRow + 1] = temp

        const newFocusIndex = arrayTable.selectedRow + 1
        setArrayTable({ selectedRow: newFocusIndex })

        updateDatatype(data.name, {
          values: newRows.map((row) => ({ description: row?.description })),
          initialValue: data.initialValue,
        } as PLCEnumeratedDatatype)
        handleFileAndWorkspaceSavedState(editor.meta.name)

        prevRows = newRows
      }
      return prevRows
    })
  }

  return (
    <div
      aria-label='Enumerated data type container'
      className='flex h-full w-full flex-1 flex-row gap-4 overflow-hidden bg-transparent'
      {...rest}
    >
      <div className='flex h-full w-full justify-between gap-8 overflow-hidden'>
        <div className='flex h-full w-[600px] flex-col overflow-hidden'>
          <div aria-label='Enumerated base type container'></div>

          <div
            aria-label='Enum data type table actions container'
            className='mb-3 flex h-8 w-full items-center justify-between'
          >
            <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
              Description
            </p>
            <div
              aria-label='Data type table actions buttons container'
              className='flex-start flex h-full *:rounded-md *:p-1'
            >
              <TableActions
                actions={[
                  {
                    ariaLabel: 'Add table row button',
                    onClick: addNewRow,
                    icon: <PlusIcon className='!stroke-brand' />,
                    id: 'add-new-row-button',
                  },
                  {
                    ariaLabel: 'Remove table row button',
                    onClick: removeRow,
                    icon: <MinusIcon className='stroke-[#0464FB]' />,
                  },
                  {
                    ariaLabel: 'Move table row up button',
                    onClick: () => moveRowUp(),
                    disabled:
                      arrayTable.selectedRow === null || arrayTable.selectedRow === 0 || arrayTable.selectedRow === -1,
                    icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                  },
                  {
                    ariaLabel: 'Move table row down button',
                    onClick: () => moveRowDown(),
                    disabled:
                      arrayTable.selectedRow === null ||
                      arrayTable.selectedRow === tableData.length - 1 ||
                      tableData.length === 1 ||
                      arrayTable.selectedRow === -1,
                    icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                  },
                ]}
              />
            </div>
          </div>

          <div className='h-full w-full overflow-auto pr-1' style={{ scrollbarGutter: 'stable' }}>
            <EnumeratedTable
              name={data.name}
              values={tableData}
              initialValue={initialValueData}
              selectedRow={arrayTable.selectedRow}
              handleRowClick={(row) => setArrayTable({ selectedRow: Number.parseInt(row.id) })}
              setArrayTable={setArrayTable}
            />
          </div>
        </div>

        <div aria-label='Enumerated initial value container' className='w-1/2'>
          <div
            aria-label='Enumerated data type initial value container'
            className='flex w-full items-center justify-end'
          >
            <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100 '>
              Initial Value:
            </label>
            <Select
              onValueChange={(value) =>
                value === 'none' ? handleInitialValueChange('') : handleInitialValueChange(value)
              }
              value={initialValueData === '' ? '' : initialValueData}
            >
              <SelectTrigger
                withIndicator
                className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 focus-within:border-brand focus:border-brand focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
              >
                {initialValueData === '' ? '' : initialValueData}
              </SelectTrigger>
              <SelectContent className='box h-fit max-h-[200px] w-[--radix-select-trigger-width] overflow-auto rounded-lg bg-white outline-none dark:bg-neutral-950'>
                <SelectItem
                  value='none'
                  className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                >
                  <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'></span>
                </SelectItem>
                {data.values.map((value) => (
                  <>
                    {value.description !== '' && (
                      <SelectItem
                        key={value.description}
                        value={value.description}
                        className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                      >
                        <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                          {value.description}
                        </span>
                      </SelectItem>
                    )}
                  </>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  )
}

export { EnumeratorDataType }
