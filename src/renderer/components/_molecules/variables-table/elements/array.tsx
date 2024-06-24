import { ComponentPropsWithoutRef, useState } from 'react'

type ArrayDimensionsComponentProps = ComponentPropsWithoutRef<'div'> & {
  values: Array<string>
}

const ArrayDimensionsComponent = (props: ArrayDimensionsComponentProps) => {
  const [currentCell, setCurrentCell] = useState('')
  const { values } = props

  const handleClick = (value: string) => {
    setCurrentCell((prev) => (prev === value ? '' : value))
  }
  return (
    <div
      aria-label='Array type table container'
      className='flex h-fit w-full flex-col *:border-x *:border-b *:border-neutral-300 [&>*:first-child]:rounded-t-lg [&>*:first-child]:border-t [&>*:last-child]:rounded-b-lg'
    >
      {values.map((value) => (
        <div
          id={value}
          aria-label='Array dimension'
          aria-selected={currentCell === value ? 'true' : 'false'}
          onClick={() => handleClick(value)}
          className='flex h-7 w-full flex-1 items-center justify-start bg-transparent px-2 py-3 font-caption text-xs text-neutral-800 hover:cursor-pointer hover:bg-neutral-50 aria-selected:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-600 dark:aria-selected:bg-neutral-700'
        >
          {value}
        </div>
      ))}
    </div>
  )
}

export { ArrayDimensionsComponent }
