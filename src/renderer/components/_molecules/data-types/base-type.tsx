import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'

const DTBaseTypeContainer = () => {
  return (
    <div aria-label='Array data type base type container' className='flex h-full w-full items-center justify-between'>
      <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
        Base type
      </label>
      <Select aria-label='Array data type base type select'>
        <SelectTrigger
          withIndicator
          placeholder='Base type'
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
  )
}

export { DTBaseTypeContainer }
