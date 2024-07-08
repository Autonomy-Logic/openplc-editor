import { MinusIcon, PencilIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { ArrayTableActions } from '@root/renderer/components/_molecules/data-types/array-table-actions'

type IDataTypeActionsProps = {
  derivation: 'enumerated' | 'structure' | 'array'
}

const EnumTableActions = () => {
  return (
    // Must be removed
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
          <div
            aria-label='Add table row button'
            className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
            onClick={() => console.log('Button clicked')}
          >
            <PencilIcon className='!stroke-brand' />
          </div>
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
            <StickArrowIcon direction='up' />
          </div>
          <div
            aria-label='Move table row down button'
            className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
            onClick={() => console.log('Button clicked')}
          >
            <StickArrowIcon direction='down' />
          </div>
        </div>
      </div>
      <div aria-label='Enum data type initial value container' className='flex h-full w-1/2 items-center justify-end '>
        <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
          Initial Value
        </label>

        <Select aria-label='Enum data type initial value select'>
          <SelectTrigger
            withIndicator
            placeholder='Initial Value'
            className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
          />
          <SelectContent
            position='popper'
            side='bottom'
            sideOffset={-28}
            className='box h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
          >
            <SelectItem
              value='Option 1'
              className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
            >
              <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                Option 1
              </span>
            </SelectItem>
            <SelectItem
              value='Option 2'
              className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
            >
              <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                Option 2
              </span>
            </SelectItem>
            <SelectItem
              value='Option 3'
              className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
            >
              <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                Option 3
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
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
          <StickArrowIcon direction='up' />
        </div>
        <div
          aria-label='Move table row down button'
          className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
          onClick={() => console.log('Button clicked')}
        >
          <StickArrowIcon direction='down' />
        </div>
      </div>
    </div>
  )
}

const DataTypeActions = (props: IDataTypeActionsProps) => {
  const { derivation } = props

  return (
    <div className='flex flex-col gap-8'>
      {derivation === 'array' && <ArrayTableActions />}
      {derivation === 'enumerated' && <EnumTableActions />}
      {derivation === 'structure' && <StructTableActions />}
    </div>
  )
}

export { DataTypeActions }
