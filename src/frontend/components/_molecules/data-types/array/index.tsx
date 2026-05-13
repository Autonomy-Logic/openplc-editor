import { ChangeEvent, ComponentPropsWithoutRef, useEffect, useState } from 'react'

import { baseTypeEnum } from '../../../../../middleware/shared/ports/plc-schemas'
import type { PLCDataType } from '../../../../../middleware/shared/ports/types'
import { MinusIcon } from '../../../../assets/icons/interface/Minus'
import { PlusIcon } from '../../../../assets/icons/interface/Plus'
import { StickArrowIcon } from '../../../../assets/icons/interface/StickArrow'
import { usePouSnapshot } from '../../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../../store'
import { InputWithRef } from '../../../_atoms/input'
import TableActions from '../../../_atoms/table-actions'
import { TypeDropdownSelector } from '../../../_atoms/type-dropdown-selector'
import { DimensionsTable } from './table'

type PLCArrayDatatype = Extract<PLCDataType, { derivation: 'array' }>

type ArrayDatatypeProps = ComponentPropsWithoutRef<'div'> & {
  data: PLCArrayDatatype
}

type Pou = { type: string; name: string }
type UserLibWithPous = { pous: Pou[] }
type UserLibFunctionBlock = { type: string; name: string }

const ArrayDataType = ({ data, ...rest }: ArrayDatatypeProps) => {
  const {
    editor,
    projectActions: { updateDatatype },
    project: {
      data: { dataTypes },
    },
    libraries: sliceLibraries,
  } = useOpenPLCStore()

  const { captureAndPush } = usePouSnapshot()

  const baseTypes = baseTypeEnum.options.filter((type) => type?.toUpperCase() !== 'ARRAY')
  // Filter to defined string names before deref'ing `.toUpperCase()` —
  // a malformed data-type / library entry (missing or null `name`)
  // would otherwise crash the whole editor on every render.
  const userDataTypes = dataTypes
    .map((type) => type.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .filter((name) => name !== editor.meta.name && name.toUpperCase() !== 'ARRAY')

  const systemFunctionBlocks = sliceLibraries.system.flatMap((lib) =>
    (lib.pous ?? [])
      .filter((pou) => pou?.type === 'function-block' && typeof pou.name === 'string')
      .map((pou) => pou.name.toUpperCase()),
  )

  const userFunctionBlocks = sliceLibraries.user.flatMap((userLib: UserLibWithPous | UserLibFunctionBlock) => {
    if ('pous' in userLib && Array.isArray(userLib.pous)) {
      return userLib.pous
        .filter((pou) => pou?.type === 'function-block' && typeof pou.name === 'string')
        .map((pou) => pou.name.toUpperCase())
    }
    const fb = userLib as UserLibFunctionBlock
    return fb.type === 'function-block' && typeof fb.name === 'string' ? [fb.name.toUpperCase()] : []
  })

  const VariableTypes = [
    { definition: 'base-type', values: baseTypes },
    { definition: 'user-data-type', values: userDataTypes },
  ]

  const LibraryTypes = [
    { definition: 'system', values: systemFunctionBlocks },
    { definition: 'user', values: userFunctionBlocks },
  ]

  const ROWS_NOT_SELECTED = -1

  const [arrayTable, setArrayTable] = useState<{ selectedRow: number }>({ selectedRow: ROWS_NOT_SELECTED })
  const [initialValueData, setInitialValueData] = useState<string>('')
  const [baseType, setBaseType] = useState<string>(data.baseType.value)

  const [tableData, setTableData] = useState<PLCArrayDatatype['dimensions']>([])

  useEffect(() => {
    setTableData(data.dimensions)
  }, [data.dimensions])

  useEffect(() => {
    setInitialValueData(data.initialValue || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setBaseType(data.baseType.value)
  }, [data.baseType])

  const handleInitialValueChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInitialValueData(e.target.value)
    const updatedData = { ...data }
    updatedData.initialValue = e.target.value
    updateDatatype(data.name, updatedData as PLCArrayDatatype)
  }

  const handleSelect = (definition: string, value: string) => {
    setBaseType(value)
    updateDatatype(data.name, {
      ...data,
      baseType: { value, definition },
    } as PLCArrayDatatype)
  }

  // `updateDatatype` is a full replace — never pass a partial object,
  // or the rest of the datatype (`name`, `derivation`, `baseType`, …)
  // gets stripped and downstream selectors lose the entry.
  const writeDimensions = (newRows: PLCArrayDatatype['dimensions']) => {
    updateDatatype(data.name, { ...data, dimensions: newRows })
  }

  const addNewRow = () => {
    setTableData((prevRows) => {
      const isFirst = prevRows.length === 0
      const newRows = [...prevRows, { dimension: '' }]

      if (isFirst) {
        captureAndPush(editor.meta.name)
      }

      setArrayTable({ selectedRow: newRows.length - 1 })
      writeDimensions(newRows)
      return newRows
    })
  }

  const removeRow = () => {
    captureAndPush(editor.meta.name)

    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null) {
        const newRows = prevRows.filter((_, index) => index !== arrayTable.selectedRow)

        const newFocusIndex = arrayTable.selectedRow === newRows.length ? newRows.length - 1 : arrayTable.selectedRow
        setArrayTable({ selectedRow: newFocusIndex })

        writeDimensions(newRows.map((row) => ({ dimension: row?.dimension })))
        prevRows = newRows
      }
      return prevRows
    })
  }

  const moveRowUp = () => {
    captureAndPush(editor.meta.name)

    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null && arrayTable.selectedRow > 0) {
        const newRows = [...prevRows]
        const temp = newRows[arrayTable.selectedRow]
        newRows[arrayTable.selectedRow] = newRows[arrayTable.selectedRow - 1]
        newRows[arrayTable.selectedRow - 1] = temp

        const newFocusIndex = arrayTable.selectedRow - 1
        setArrayTable({ selectedRow: newFocusIndex })

        writeDimensions(newRows.map((row) => ({ dimension: row?.dimension })))
        prevRows = newRows
      }
      return prevRows
    })
  }

  const moveRowDown = () => {
    captureAndPush(editor.meta.name)

    setTableData((prevRows) => {
      if (arrayTable.selectedRow !== null && arrayTable.selectedRow < prevRows.length - 1) {
        const newRows = [...prevRows]
        const temp = newRows[arrayTable.selectedRow]
        newRows[arrayTable.selectedRow] = newRows[arrayTable.selectedRow + 1]
        newRows[arrayTable.selectedRow + 1] = temp

        const newFocusIndex = arrayTable.selectedRow + 1
        setArrayTable({ selectedRow: newFocusIndex })

        writeDimensions(newRows.map((row) => ({ dimension: row?.dimension })))
        prevRows = newRows
      }
      return prevRows
    })
  }

  return (
    <div aria-label='Array data type container' className='flex h-full w-full flex-col gap-4 bg-transparent' {...rest}>
      <div aria-label='Data type content actions container' className='flex h-fit w-full gap-8'>
        <div aria-label='Array base type container' className='flex w-1/2 flex-col gap-3'>
          <div aria-label='Array base type content' className='flex h-fit w-full items-center justify-between'>
            <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
              Base Type
            </label>

            <TypeDropdownSelector
              value={baseType}
              onSelect={handleSelect}
              variableTypes={VariableTypes}
              libraryTypes={LibraryTypes}
            />
          </div>
        </div>
        <div aria-label='Array initial value container' className='w-1/2'>
          <div
            aria-label='Array data type initial value container'
            className='flex h-fit w-full items-center justify-end'
          >
            <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100 '>
              Initial Value:
            </label>
            <InputWithRef
              onChange={handleInitialValueChange}
              value={initialValueData}
              className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 focus-within:border-brand focus:border-brand focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
            />
          </div>
        </div>
      </div>

      <div className='flex w-[600px] flex-col gap-3'>
        <div aria-label='Array data type table actions container' className='flex h-fit items-center justify-between'>
          <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
            Dimensions
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
                  onClick: moveRowUp,
                  disabled: arrayTable.selectedRow === ROWS_NOT_SELECTED || arrayTable.selectedRow === 0,
                  icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                },
                {
                  ariaLabel: 'Move table row down button',
                  onClick: moveRowDown,
                  disabled:
                    arrayTable.selectedRow === ROWS_NOT_SELECTED || arrayTable.selectedRow === tableData.length - 1,
                  icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                },
              ]}
            />
          </div>
        </div>

        <DimensionsTable
          name={data.name}
          tableData={tableData}
          handleRowClick={(row) => setArrayTable({ selectedRow: parseInt(row.id) })}
          selectedRow={arrayTable.selectedRow}
          setArrayTable={setArrayTable}
        />
      </div>
    </div>
  )
}

export { ArrayDataType }
