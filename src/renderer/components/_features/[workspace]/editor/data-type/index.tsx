import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'

const DataTypeEditor = () => {
  return (
    <div aria-label='Data type editor container' className='flex h-full w-full flex-col items-center px-12 py-2'>
      <div
        aria-label='Data type metadata container'
        className='mb-4 flex h-20 w-full items-center gap-4 rounded-lg border border-neutral-200 bg-white px-[64px] py-[4px] shadow-lg dark:border-neutral-800 dark:bg-neutral-950'
      >
        <div aria-label='Data type name container' className='flex h-full w-1/2 items-center gap-2'>
          <label
            htmlFor='data-type-name'
            className='mb-1 text-start font-caption text-xs font-medium text-neutral-950 dark:text-white'
          >
            DataType Name
          </label>
          <div
            aria-label='Data type name input container'
            className='h-[32px] w-full max-w-[385px] rounded-lg border border-neutral-100 bg-white dark:border-neutral-700 dark:bg-neutral-950'
          >
            <InputWithRef
              id='data-type-name'
              aria-label='data-type-name'
              className='h-full w-full max-w-[385px] bg-transparent text-center font-caption text-xs text-neutral-850 outline-none dark:text-neutral-100'
            />
          </div>
        </div>
        <div aria-label='Data type derivation container' className='flex h-full w-1/2 items-center gap-2'>
          <label
            aria-label='label for data-type-derivation'
            className='mb-1 text-start font-caption text-xs font-normal text-neutral-950 dark:text-white'
          >
            Derivation Type
          </label>
          <Select aria-label='data-type-derivation'>
            <SelectTrigger
              placeholder='derivation'
              className='flex h-[32px] w-full max-w-[385px] items-center justify-evenly rounded-lg border border-neutral-100 bg-white px-4 dark:border-neutral-700 dark:bg-neutral-950'
            />
            <SelectContent
              position='popper'
              side='bottom'
              sideOffset={-20}
              className='h-fit w-[200px] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
            >
              <SelectItem
                value='Option 1'
                className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                  Option 1
                </span>
              </SelectItem>
              <SelectItem
                value='Option 2'
                className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                  Option 2
                </span>
              </SelectItem>
              <SelectItem
                value='Option 3'
                className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                  Option 3
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div
        aria-label='Data type content container'
        className='flex h-full w-full gap-4 rounded-lg border border-neutral-200 bg-white px-2 py-[4px] shadow-lg dark:border-neutral-800 dark:bg-neutral-950'
      >
        {/** Here goes the fields to create the data type */}
      </div>
    </div>
  )
}

export { DataTypeEditor }
