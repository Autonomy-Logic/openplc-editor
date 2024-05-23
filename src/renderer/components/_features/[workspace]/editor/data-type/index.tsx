// import { MinusIcon, PencilIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'

import { DataTypeActions } from './actions'

const DataTypeEditor = () => {
  return (
    <div aria-label='Data type editor container' className='flex h-full w-full flex-col items-center p-2'>
      <div
        aria-label='Data type metadata container'
        className='h-46 mb-4 flex w-full items-center gap-4 rounded-md bg-neutral-50 p-2 shadow-md dark:border dark:border-neutral-800 dark:bg-neutral-1000'
      >
        <div aria-label='Data type name container' className='flex h-fit w-1/2 items-center gap-2'>
          <label
            htmlFor='data-type-name'
            className='mb-1 text-start font-caption text-xs font-medium text-neutral-950 dark:text-white'
          >
            Name
          </label>
          <div
            aria-label='Data type name input container'
            className='h-[30px] w-full max-w-[385px] rounded-lg border border-neutral-400 bg-white focus-within:border-brand dark:border-neutral-800 dark:bg-neutral-950'
          >
            <InputWithRef
              id='data-type-name'
              aria-label='data-type-name'
              className='h-full w-full bg-transparent px-3 text-start font-caption text-xs text-neutral-850 outline-none dark:text-neutral-100'
            />
          </div>
        </div>
        <div aria-label='Data type derivation container' className='flex h-full w-1/2 items-center gap-2'>
          <label
            aria-label='label for data-type-derivation'
            className='mb-1 text-start font-caption text-xs font-medium text-neutral-950 dark:text-white'
          >
            Derivation Type
          </label>
          <Select aria-label='data-type-derivation'>
            <SelectTrigger
              withIndicator
              placeholder='Derivation'
              className='flex h-[30px] w-full max-w-[385px] items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
            />
            <SelectContent
              position='popper'
              side='bottom'
              sideOffset={-30}
              className='h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg border border-brand-light bg-white shadow-card outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:shadow-dark-card'
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
      <div
        aria-label='Data type content container'
        className='flex h-full w-full flex-col gap-4 border border-neutral-200 bg-transparent'
      >
        <div
          aria-label='Data type content actions container'
          className='flex h-8 w-full items-center justify-between border border-neutral-400'
        >
          {/* <div aria-label='Data type content actions container'></div> */}
        </div>
        <div aria-label='Data type content editor container'>
          <DataTypeActions _derivation='array' />
        </div>
      </div>
    </div>
  )
}

export { DataTypeEditor }
