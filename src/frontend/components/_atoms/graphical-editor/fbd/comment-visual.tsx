import { ReactNode } from 'react'

import { cn } from '../../../../utils/cn'
import { MINIMUM_ELEMENT_HEIGHT, MINIMUM_ELEMENT_WIDTH } from './utils/constants'

export type CommentVisualProps = {
  content: string
  width?: number
  height?: number
  selected?: boolean
  className?: string
  /** Optional slot to replace the default comment text (e.g. with a HighlightedTextArea) */
  contentSlot?: ReactNode
}

export const CommentVisual = ({
  content,
  width = MINIMUM_ELEMENT_WIDTH,
  height = MINIMUM_ELEMENT_HEIGHT,
  selected = false,
  className,
  contentSlot,
}: CommentVisualProps) => {
  return (
    <div
      style={{ width, height }}
      className={cn(
        'relative flex items-center justify-center rounded-md border border-neutral-850 bg-white p-1 text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
        'hover:border-transparent hover:ring-2 hover:ring-brand',
        {
          'border-transparent ring-2 ring-brand': selected,
        },
        className,
      )}
    >
      <div className='flex items-center justify-center p-2' style={{ width, height }}>
        {contentSlot !== undefined ? (
          contentSlot
        ) : (
          <span className='whitespace-pre-wrap text-center text-xs leading-3 opacity-60'>
            {content || 'Add some text...'}
          </span>
        )}
      </div>
    </div>
  )
}
