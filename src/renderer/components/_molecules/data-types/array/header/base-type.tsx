import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { baseTypeSchema } from '@root/types/PLC/open-plc'

const DTBaseTypeContainer = () => {
  const baseTypes = baseTypeSchema.options
  return (
    <div aria-label='Array base type content' className='flex h-fit w-full items-center justify-between'>
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
          className='box h-fit w-[--radix-select-trigger-width] overflow-hidden overflow-y-scroll rounded-lg bg-white outline-none dark:bg-neutral-950'
        >
          {baseTypes.map((type, idx) => {
            return (
              <SelectItem
                key={idx}
                value={type}
                className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                  {type.toLocaleUpperCase()}
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}

export { DTBaseTypeContainer }
