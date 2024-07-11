import { StickArrowIcon } from '@root/renderer/assets/icons/interface/StickArrow'
import { cn } from '@root/utils'
import { useEffect, useRef, useState } from 'react'

type RungHeaderProps = {
  isOpen: boolean
  onClick: () => void
}

export const RungHeader = ({ isOpen, onClick }: RungHeaderProps) => {
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const [textAreaValue, setTextAreaValue] = useState<string>('')
  const onTextAreaChange = (value: string) => {
    setTextAreaValue(value)
  }

  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = 'auto'
      textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`
    }
  }, [textAreaValue])

  return (
    <div
      aria-label='Rung header'
      className={cn(
        'flex w-full flex-row gap-2 rounded-lg border bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900',
        {
          'rounded-b-none border-b-0': isOpen,
        },
      )}
    >
      <div className='flex w-full items-center rounded-lg border border-transparent p-2 focus-within:border-neutral-200 focus-within:dark:border-neutral-800'>
        <textarea
          aria-label='Rung name and description'
          className='w-full resize-none overflow-hidden bg-transparent text-sm opacity-50 outline-none focus:opacity-100'
          placeholder='Start typing to add a comment to this rung'
          ref={textAreaRef}
          rows={1}
          onChange={(e) => onTextAreaChange(e.currentTarget.value)}
          value={textAreaValue}
        />
      </div>
      <div className='p-1'>
        <button
          aria-label='Expand body button'
          onClick={onClick}
          className='h-fit rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
        >
          <StickArrowIcon direction={isOpen ? 'up' : 'down'} className='stroke-[#0464FB] dark:stroke-brand-light' />
        </button>
      </div>
    </div>
  )
}
