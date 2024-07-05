import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'

type ArrayDimensionsComponentProps = ComponentPropsWithoutRef<'div'> & {
  id: string
  initialValue: string
  selectedInput: string
  handleInputClick: (value: string) => void
  handleUpdateDimension: (index: number, value: string) => void
}

const ArrayDimensionsInput = ({
  id,
  initialValue,
  selectedInput,
  handleInputClick,
  handleUpdateDimension,
}: ArrayDimensionsComponentProps) => {
  const [inputValue, setInputValue] = useState(initialValue)

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  useEffect(() => {
    setInputValue(initialValue)
  }, [initialValue])

  return (
    <div
      id={id}
      aria-label='Array dimension input'
      aria-selected={selectedInput === id ? 'true' : 'false'}
      onClick={() => handleInputClick(id)}
      className='flex h-7 w-full flex-1 items-center justify-start text-neutral-800 hover:cursor-pointer hover:bg-neutral-50 aria-selected:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-600 dark:aria-selected:bg-neutral-700'
    >
      <input
        type='text'
        className={cn('h-full w-full bg-transparent px-2 py-3 font-caption text-xs outline-none', {
          'pointer-events-none': selectedInput !== id,
        })}
        onChange={onChange}
        onBlur={() => handleUpdateDimension(Number(id), inputValue)}
        value={inputValue}
      />
    </div>
  )
}

export { ArrayDimensionsInput }
