import { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import { TrashCanIcon } from '@root/renderer/assets'
import { StickArrowIcon } from '@root/renderer/assets/icons/interface/StickArrow'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungState } from '@root/renderer/store/slices'
import { cn } from '@root/utils'
import { useEffect, useRef, useState } from 'react'

type RungHeaderProps = {
  rung: RungState
  isOpen: boolean
  draggableHandleProps: DraggableProvidedDragHandleProps | null
  className: string
  onClick: () => void
}

export const RungHeader = ({ rung, isOpen, draggableHandleProps, className, onClick }: RungHeaderProps) => {
  const {
    editor: {
      meta: { name: editorName },
    },
    flowActions: { addComment, removeRung },
  } = useOpenPLCStore()

  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const [textAreaValue, setTextAreaValue] = useState<string>(rung.comment ?? '')
  const onTextAreaChange = (value: string) => {
    setTextAreaValue(value)
  }

  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = 'auto'
      textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`
    }
  }, [textAreaValue])

  useEffect(() => {
    setTextAreaValue(rung.comment ?? '')
  }, [rung.comment])

  const handleRemoveRung = () => {
    removeRung(editorName, rung.id)
  }

  return (
    <div
      {...(draggableHandleProps ?? {})}
      aria-label='Rung header'
      className={cn(
        'flex w-full flex-row gap-2 bg-neutral-50 p-1 dark:bg-neutral-900',
        // 'rounded-lg border dark:border-neutral-800',
        {
          'rounded-b-none border-b-0': isOpen,
        },
        className,
      )}
    >
      <div className='flex w-full items-center rounded-lg border border-transparent px-1'>
        <textarea
          aria-label='Rung name and description'
          className='w-full resize-none overflow-hidden bg-transparent text-xs opacity-50 outline-none focus:opacity-100'
          placeholder='Start typing to add a comment to this rung'
          ref={textAreaRef}
          rows={1}
          onChange={(e) => onTextAreaChange(e.currentTarget.value)}
          value={textAreaValue}
          onBlur={() => addComment({ editorName, rungId: rung.id, comment: textAreaValue })}
        />
      </div>
      <div className='flex flex-row gap-1'>
        <button
          aria-label='Delete body button'
          onClick={handleRemoveRung}
          className='h-fit rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
        >
          <TrashCanIcon className='h-5 w-5 stroke-[#0464FB] dark:stroke-brand-light' />
        </button>
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
