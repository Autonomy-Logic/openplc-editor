import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
// import { useOpenPLCStore } from '@root/renderer/store'
import { PLCEnumeratedDatatype } from '@root/types/PLC/open-plc'
import _ from 'lodash'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'

import { EnumeratedTable } from './table'

type EnumDatatypeProps = ComponentPropsWithoutRef<'div'> & {
  data: PLCEnumeratedDatatype
}
const EnumeratorDataType = ({ data, ...rest }: EnumDatatypeProps) => {
  const [initialValueData, setInitialValueData] = useState<string>('none')

  useEffect(() => {
    setInitialValueData(data.initialValue || 'none')
  }, [data.initialValue, data.name])

  return (
    <div
      aria-label='Enumerated data type container'
      className='flex h-full w-full flex-1 flex-col gap-4 overflow-hidden bg-transparent'
      {...rest}
    >
      <div aria-label='Data type content actions container' className='flex h-8 w-full gap-8'>
        <div aria-label='Enumerated base type container' className='flex w-1/2 flex-col gap-3'></div>
        <div aria-label='Enumerated initial value container' className='w-1/2'>
          <div
            aria-label='Enumerated data type initial value container'
            className='h- flex w-full items-center justify-end'
          >
            <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100 '>
              Initial Value:
            </label>
            <Select>
              <SelectTrigger
                withIndicator
                className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 focus-within:border-brand focus:border-brand focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
              >
                {initialValueData === 'none' ? '' : initialValueData}
              </SelectTrigger>
              <SelectContent className='box h-fit  max-h-[200px] w-[--radix-select-trigger-width] overflow-auto  rounded-lg bg-white outline-none dark:bg-neutral-950'>
                <SelectItem
                  value='none'
                  className='flex h-8 w-full cursor-pointer items-center  justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  onClick={() => setInitialValueData('none')}
                >
                  <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                    {''}
                  </span>
                </SelectItem>
                {data.values.map((value) => (
                  <SelectItem
                    key={value.description}
                    value={value.description}
                    className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    onClick={() => setInitialValueData(value.description)}
                  >
                    <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                      {value.description}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <EnumeratedTable name={data.name} values={data.values} />
    </div>
  )
}

export { EnumeratorDataType }
