import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'

import { EnumeratorDTInitialValueContainer } from './initial-value'

const EnumeratorDataType = () => {
  return (
    <div className='flex h-fit w-full'>
      <div
        aria-label='Enum data type table actions container'
        className='flex h-full w-1/2 items-center justify-between'
      >
        <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
          Values
        </p>
        <div
          aria-label='Data type table actions buttons container'
          className='flex h-full w-fit items-center justify-evenly *:rounded-md *:p-1'
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
      <div className='w-1/2'>
        <EnumeratorDTInitialValueContainer />
      </div>
    </div>
  )
}

export { EnumeratorDataType }
