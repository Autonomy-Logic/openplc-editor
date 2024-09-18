import { ArrowUp, MinusIcon, PlusIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { cn } from '@root/utils'
import { useState } from 'react'

import { CodeDisplay, TableDisplay } from './data-display'
import { IVariableProps } from './types'

const Variables = () => {
  const [visibility, setVisibility] = useState<'code' | 'table'>('table')
  const [variablesData, setVariablesData] = useState<IVariableProps[]>([
    {
      id: 1,
      name: '',
      class: 'Input',
      type: 'Array',
      location: '',
      initialValue: '',
      debug: false,
      documentation: '',
    },
  ])

  const addTableRow = () => {
    const newRow = { ...variablesData[0], id: variablesData.length + 1 }
    setVariablesData([...variablesData, newRow])
  }

  const removeTableRow = (idToRemove: number) => {
    setVariablesData(variablesData.filter((row) => row.id !== idToRemove))
  }
  return (
    <div id='Variables container'>
      <div
        id='Variables actions container'
        className={cn('mb-4 flex', visibility === 'table' ? 'justify-between' : 'justify-end')}
      >
        {visibility === 'table' && (
          <div id='Table actions' className='mr-4 flex flex-1 justify-between'>
            <div className='flex gap-4'>
              <div className='flex items-center gap-4 text-xs font-medium text-neutral-1000 dark:text-neutral-300'>
                Description:
                <input className='h-8 w-80 rounded-lg border border-neutral-100 bg-inherit px-2 text-[10px] font-medium text-neutral-850 focus:outline-none dark:text-white' />
              </div>
              <div className='flex items-center gap-4 text-xs font-medium text-neutral-1000 dark:text-neutral-300'>
                Class Filter:
                <select className='h-8 w-48 rounded-lg border border-neutral-100 bg-inherit px-2 text-[10px] font-medium text-neutral-850 focus:outline-none dark:text-white '>
                  <option value='local'>Local</option>
                </select>
              </div>
            </div>
            <div className='flex items-center gap-3'>
              <PlusIcon className='h-5 w-5 !stroke-brand' onClick={addTableRow} />
              <MinusIcon className='h-5 w-5 stroke-brand' onClick={() => removeTableRow(variablesData.length)} />
              <ArrowUp className='h-5 w-5 stroke-brand' />
              <ArrowUp className='h-5 w-5 rotate-180 stroke-brand' />
            </div>
          </div>
        )}
        <div className='relative flex h-full items-center overflow-hidden rounded-md'>
          <TableIcon
            size='md'
            onClick={() => setVisibility('table')}
            currentVisible={visibility === 'table'}
            className={
              visibility === 'table' ? 'rounded-l-md fill-brand' : 'rounded-l-md fill-neutral-100 dark:fill-neutral-900'
            }
          />
          <CodeIcon
            size='md'
            onClick={() => setVisibility('code')}
            currentVisible={visibility === 'code'}
            className={
              visibility === 'code' ? 'rounded-r-md fill-brand' : 'rounded-r-md fill-neutral-100 dark:fill-neutral-900'
            }
          />
        </div>
      </div>
      <div id='Variables data'>
        {visibility === 'table' ? (
          <div id='Variables table root' className='oplc-scrollbar w-full min-w-28 overflow-auto pb-2 pr-2'>
            <div
              id='Variable table container'
              className='flex w-full min-w-max flex-1 rounded-lg border border-neutral-500 dark:border-neutral-850'
            >
              <TableDisplay data={variablesData} />
            </div>
          </div>
        ) : (
          <CodeDisplay />
        )}
      </div>
    </div>
  )
}

export { Variables }
