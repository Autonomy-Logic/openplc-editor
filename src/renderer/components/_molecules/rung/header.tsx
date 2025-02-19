 
import { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import { CloseIcon } from '@root/renderer/assets'
import { DragHandleIcon } from '@root/renderer/assets/icons/interface/DragHandle'
import { StickArrowIcon } from '@root/renderer/assets/icons/interface/StickArrow'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungState } from '@root/renderer/store/slices'
import { cn } from '@root/utils'
import { useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../_atoms'

type RungHeaderProps = {
  rung: RungState
  isOpen: boolean
  draggableHandleProps: DraggableProvidedDragHandleProps | undefined
  className: string
  onClick: () => void
}

export const RungHeader = ({ rung, isOpen, draggableHandleProps, className, onClick }: RungHeaderProps) => {
  const {
    editor,
    flowActions: { addComment },
    modalActions: { openModal },
  } = useOpenPLCStore()

  const editorName = editor.meta.name

  const containerRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const [textAreaValue, setTextAreaValue] = useState<string>(rung.comment ?? '')

  useEffect(() => {
    if (containerRef.current && textAreaRef.current) {
      containerRef.current.style.height =
        28 > textAreaRef.current.scrollHeight ? '28px' : `${textAreaRef.current.scrollHeight}px`
    }
  }, [textAreaValue])

  // useEffect(() => {
  //   if (textAreaRef.current) {
  //     textAreaRef.current.style.height = 'auto'
  //     textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`
  //   }
  // }, [textAreaValue])

  useEffect(() => {
    setTextAreaValue(rung.comment ?? '')
  }, [rung.comment])

  const handleRemoveRung = () => {
    openModal('confirm-delete-element', rung)
  }

  return (
    <div
      aria-label='Rung header'
      className={cn(
        'flex w-full flex-row bg-neutral-50 p-1 dark:bg-neutral-900',
        // 'rounded-lg border dark:border-neutral-800',
        {
          'rounded-b-none border-b-0': isOpen,
        },
        className,
      )}
    >
      <div {...(draggableHandleProps ?? {})} className='flex items-center'>
        <DragHandleIcon className='h-7 w-7 fill-[#0464FB] dark:fill-brand-light' />
      </div>
      <div className='flex w-full items-center rounded-lg border border-transparent px-1' ref={containerRef}>
        {/* <textarea
          aria-label='Rung name and description'
          className='w-full resize-none overflow-hidden bg-transparent text-xs outline-none'
          placeholder='Start typing to add a comment to this rung'
          ref={textAreaRef}
          rows={1}
          onChange={(e) => setTextAreaValue(e.target.value)}
          value={textAreaValue}
          onBlur={() => addComment({ editorName, rungId: rung.id, comment: textAreaValue })}
        /> */}
        <HighlightedTextArea
          placeholder='Start typing to add a comment to this rung'
          textAreaClassName='text-xs'
          highlightClassName='text-xs'
          ref={textAreaRef}
          textAreaValue={textAreaValue}
          setTextAreaValue={setTextAreaValue}
          handleSubmit={() => addComment({ editorName, rungId: rung.id, comment: textAreaValue })}
          submitWith={{ enter: false }}
        />
      </div>
      <div className='flex flex-row gap-1'>
        <button
          aria-label='Delete body button'
          onClick={handleRemoveRung}
          className='flex h-full w-7 items-center justify-center rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
        >
          <CloseIcon className='h-4 w-4 stroke-brand dark:stroke-brand-light' />
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
