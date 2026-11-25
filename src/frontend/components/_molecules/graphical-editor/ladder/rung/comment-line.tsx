import { commentFirstLine, LADDER_STYLE, LADDER_TYPOGRAPHY } from '@root/middleware/shared/utils/ladder-layout'
import { type ReactNode, useState } from 'react'

import { useOpenPLCStore } from '../../../../../store'
import { searchMatchRanges } from '../../../../_atoms/graphical-editor/ladder/ladder-text'

/** `text` with every project-search match wrapped in a highlight, as React elements, never as markup. */
function highlighted(text: string, query: string): ReactNode {
  const ranges = searchMatchRanges(text, query)
  if (ranges.length === 0) return text
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of ranges) {
    parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} className='rounded-sm bg-brand-light text-inherit dark:bg-brand-medium-dark'>
        {text.slice(start, end)}
      </mark>,
    )
    at = end
  }
  parts.push(text.slice(at))
  return parts
}

type RungCommentLineProps = {
  comment: string
  editing: boolean
  onCommit: (comment: string) => void
  onEditingChange: (editing: boolean) => void
}

/** The rung comment: one muted line above the rung, "Add comment" on hover when empty, or a field while editing. */
export const RungCommentLine = ({ comment, editing, onCommit, onEditingChange }: RungCommentLineProps) => {
  const searchQuery = useOpenPLCStore((state) => state.searchQuery)
  const [value, setValue] = useState(comment)
  const style = {
    height: LADDER_STYLE.commentH,
    paddingLeft: LADDER_STYLE.gutter + 12,
    fontFamily: LADDER_TYPOGRAPHY.family,
    fontSize: LADDER_TYPOGRAPHY.commentSizePx,
  }

  if (editing) {
    return (
      <div className='flex items-center pr-6' style={style}>
        <input
          aria-label='Rung comment field'
          autoFocus
          className='w-full rounded-[2px] bg-transparent px-1 text-neutral-700 outline outline-1 outline-brand dark:text-neutral-300'
          value={value}
          placeholder='Rung comment'
          onFocus={() => setValue(comment)}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            onEditingChange(false)
            if (value !== comment) onCommit(value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setValue(comment)
              onEditingChange(false)
            }
          }}
        />
      </div>
    )
  }

  return (
    <div
      aria-label='Rung comment'
      title={comment.includes('\n') ? comment : undefined}
      className='truncate pr-6 leading-[22px] text-neutral-500 dark:text-neutral-400'
      style={style}
      onDoubleClick={() => onEditingChange(true)}
    >
      {comment === '' ? (
        <button
          type='button'
          aria-label='Add comment'
          className='opacity-0 transition-opacity focus-visible:opacity-60 group-hover:opacity-60'
          onClick={() => onEditingChange(true)}
        >
          Add comment
        </button>
      ) : (
        highlighted(commentFirstLine(comment), searchQuery)
      )}
    </div>
  )
}
