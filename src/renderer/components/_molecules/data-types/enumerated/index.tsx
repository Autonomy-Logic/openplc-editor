import { InputWithRef} from '@root/renderer/components/_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCEnumeratedDatatype } from '@root/types/PLC/open-plc'
import _ from 'lodash'
import { ChangeEvent, ComponentPropsWithoutRef, useEffect, useState } from 'react'

import { EnumeratedTable } from './table'

type EnumDatatypeProps = ComponentPropsWithoutRef<'div'> & {
  data: PLCEnumeratedDatatype
}
const EnumeratorDataType = ({ data, ...rest }: EnumDatatypeProps) => {
  const {
    projectActions: { updateDatatype },
  } = useOpenPLCStore()
  const ROWS_NOT_SELECTED = -1
  const [enumTable, setEnumTable] = useState<{ selectedRow: string }>({ selectedRow: ROWS_NOT_SELECTED.toString() })
  const [initialValueData, setInitialValueData] = useState<string>('')

  useEffect(() => {
    setInitialValueData(data.initialValue)
  }, [data.initialValue, data.name])

  const handleInitialValueChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInitialValueData(e.target.value)
    _.debounce(() => {
      const updatedData = { ...data }
      updatedData.initialValue = e.target.value
      updateDatatype(data.name, updatedData as PLCEnumeratedDatatype)
    }, 1000)()
  }

  return (
    <div
      aria-label='Enumerated data type container'
      className='flex h-full w-full flex-col gap-4 bg-transparent'
      {...rest}
    >
      <div aria-label='Data type content actions container' className='flex h-fit w-full gap-8'>
        <div aria-label='Enumerated base type container' className='flex w-1/2 flex-col gap-3'>
    
        </div>
        <div aria-label='Enumerated initial value container' className='w-1/2'>
          <div
            aria-label='Enumerated data type initial value container'
            className='flex h-fit w-full items-center justify-end'
          >
            <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100 '>
              Initial Value
            </label>
            <InputWithRef
              onChange={handleInitialValueChange}
              value={initialValueData}
              className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 focus-within:border-brand focus:border-brand focus:outline-none dark:border-neutral-800 dark:border-neutral-800 dark:bg-neutral-950 dark:bg-neutral-950 dark:text-neutral-100'
            />
          </div>
        </div>
      </div>
      <EnumeratedTable
        name={data.name}
        values={data.values}
        handleRowClick={(row) => setEnumTable({ selectedRow: row.id })}
        selectedRow={parseInt(enumTable.selectedRow)}
      />
    </div>
  )
}

export { EnumeratorDataType }
