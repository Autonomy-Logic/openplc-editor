import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'

type ArrayDimensionsComponentProps = ComponentPropsWithoutRef<'div'> & {
  id: string
  initialValue: string
  selectedInput: string
  handleInputClick: (value: string) => void
  handleUpdateDimension: (index: number, value: string) => { ok: boolean }
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

  const handleUpdate = () => {
    const res = handleUpdateDimension(Number(id), inputValue)
    if (!res.ok) setInputValue(initialValue)
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
      className={cn(
        'flex h-full w-full items-center justify-start text-neutral-800 dark:text-neutral-100',
        'border-b border-b-neutral-300 dark:border-b-neutral-800',
        'aria-selected:ring-1 aria-selected:ring-brand',
        'dark:aria-selected:border-b-brand dark:aria-selected:border-l-brand dark:aria-selected:border-r-brand dark:aria-selected:border-t-brand',
      )}
    >
      <input
        type='text'
        className={cn(
          'h-8 w-full bg-transparent px-2 text-center font-caption text-xs outline-none',
          'aria-selected:bg-transparent aria-selected:focus:bg-neutral-50 dark:aria-selected:focus:bg-neutral-700',
          {
            'pointer-events-none': selectedInput !== id,
          },
        )}
        onChange={onChange}
        onBlur={handleUpdate}
        value={inputValue}
        aria-selected={selectedInput === id ? 'true' : 'false'}
      />
    </div>
  )
}

export { ArrayDimensionsInput }
