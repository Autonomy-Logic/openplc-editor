import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'
import { LADDER_STYLE, LADDER_TYPOGRAPHY } from '@root/middleware/shared/utils/ladder-layout'
import type { MouseEvent } from 'react'

import { DragHandleIcon } from '../../../../../assets/icons/interface/DragHandle'
import { cn } from '../../../../../utils/cn'
import { useLadderThemePalette } from '../../../../_atoms/graphical-editor/ladder/rung-view'

type RungGutterProps = {
  /** The 1-based rung number, or the text shown in place of it (End). */
  label: string
  selected: boolean
  /** Y of the rung's main wire inside the rung container. */
  wireTop: number
  dragListeners?: SyntheticListenerMap
  onSelect?: () => void
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
}

/** The left gutter of a rung: its number on the main wire, the drag grip on hover; its right edge is the left rail. */
export const RungGutter = ({ label, selected, wireTop, dragListeners, onSelect, onContextMenu }: RungGutterProps) => {
  const palette = useLadderThemePalette()
  return (
    <div
      aria-label='Rung gutter'
      aria-selected={selected}
      className={cn('group absolute bottom-0 left-0 top-0 select-none', onSelect && 'cursor-pointer')}
      style={{ width: LADDER_STYLE.gutter - 1, background: selected ? palette.brand : undefined }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {dragListeners && (
        <div
          aria-label='Rung drag handle'
          {...dragListeners}
          className='absolute left-0.5 cursor-grab opacity-0 group-hover:opacity-100'
          style={{ top: wireTop - 8 }}
        >
          <DragHandleIcon className={cn('h-4 w-4', selected ? 'fill-white' : 'fill-neutral-500')} />
        </div>
      )}
      <span
        aria-label='Rung number'
        className='absolute right-2.5 leading-4'
        style={{
          top: wireTop - 8,
          fontFamily: LADDER_TYPOGRAPHY.family,
          fontSize: LADDER_TYPOGRAPHY.nameSizePx,
          fontWeight: selected ? LADDER_TYPOGRAPHY.semiboldWeight : 500,
          color: selected ? '#ffffff' : palette.muted,
        }}
      >
        {label}
      </span>
    </div>
  )
}
