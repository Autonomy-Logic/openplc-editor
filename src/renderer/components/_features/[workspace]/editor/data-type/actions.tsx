import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'

type IDataTypeActionsProps = {
  derivation: 'enumerated' | 'structure' | 'array'
}

const StructTableActions = () => {
  return (
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
        <div
          aria-label='Add table row button'
          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
          onClick={() => console.log('Button clicked')}
        >
          <PlusIcon className='!stroke-brand' />
        </div>
        <div
          aria-label='Remove table row button'
          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
          onClick={() => console.log('Button clicked')}
        >
          <MinusIcon />
        </div>
        <div
          aria-label='Move table row up button'
          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
          onClick={() => console.log('Button clicked')}
        >
          <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
        </div>
        <div
          aria-label='Move table row down button'
          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
          onClick={() => console.log('Button clicked')}
        >
          <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
        </div>
      </div>
    </div>
  )
}

const DataTypeActions = (props: IDataTypeActionsProps) => {
  const { derivation } = props

  return (
    <div className='flex flex-col gap-8'>
      {derivation === 'structure' && <StructTableActions />}
    </div>
  )
}

export { DataTypeActions }
