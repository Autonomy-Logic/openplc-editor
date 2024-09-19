import { useState } from 'react'

const ArrayDataTypeInitialValueContainer = () => {
  const [value, setValue] = useState<string | number | undefined>()

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value)
  }

  return (
    <div aria-label='Array data type initial value container' className='flex h-fit w-full items-center justify-end'>
      <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
        Initial Value
      </label>
      <input
        onChange={handleChange}
        value={value}
        className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
      /> 
    </div>
  )
}

export { ArrayDataTypeInitialValueContainer }
