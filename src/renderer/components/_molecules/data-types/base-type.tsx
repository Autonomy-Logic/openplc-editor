import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'

const DTBaseTypeContainer = () => {
  return (
    <div aria-label='Array data type base type container' className='flex h-fit w-full items-center justify-between'>
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
            value='Bool'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              BOOL
            </span>
          </SelectItem>
          <SelectItem
            value='Sint'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              SINT
            </span>
          </SelectItem>
          <SelectItem
            value='Int'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              INT
            </span>
          </SelectItem>
          <SelectItem
            value='Dint'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              DINT
            </span>
          </SelectItem>
          <SelectItem
            value='Lint'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              LINT
            </span>
          </SelectItem>
          <SelectItem
            value='Usint'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              USINT
            </span>
          </SelectItem>
          <SelectItem
            value='Uint'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              UINT
            </span>
          </SelectItem>
          <SelectItem
            value='Udint'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              UDINT
            </span>
          </SelectItem>
          <SelectItem
            value='Ulint'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              ULINT
            </span>
          </SelectItem>
          <SelectItem
            value='Real'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              REAL
            </span>
          </SelectItem>
          <SelectItem
            value='Lreal'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              LREAL
            </span>
          </SelectItem>
          <SelectItem
            value='Time'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              TIME
            </span>
          </SelectItem>
          <SelectItem
            value='Date'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              DATE
            </span>
          </SelectItem>
          <SelectItem
            value='Tod'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              TOD
            </span>
          </SelectItem>
          <SelectItem
            value='Dt'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              DT
            </span>
          </SelectItem>
          <SelectItem
            value='String'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              STRING
            </span>
          </SelectItem>
          <SelectItem
            value='Byte'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              BYTE
            </span>
          </SelectItem>
          <SelectItem
            value='Word'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              WORD
            </span>
          </SelectItem>
          <SelectItem
            value='Dword'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              DWORD
            </span>
          </SelectItem>{' '}
          <SelectItem
            value='Lword'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              LWORD
            </span>
          </SelectItem>{' '}
          <SelectItem
            value='Loglevel'
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              LOGLEVEL
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export { DTBaseTypeContainer }
