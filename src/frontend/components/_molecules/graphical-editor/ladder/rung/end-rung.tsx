import { LADDER_STYLE, LADDER_TYPOGRAPHY } from '@root/middleware/shared/utils/ladder-layout'

import { PlusIcon } from '../../../../../assets/icons/interface/Plus'
import { useIsEditingLocked } from '../../../../../hooks/use-editing-lock'
import { useLadderThemePalette } from '../../../../_atoms/graphical-editor/ladder/rung-view'
import { RungGutter } from './gutter'

const END_RUNG_HEIGHT = 44

type EndRungProps = {
  /** X of the POU's right rail in rung coordinates. */
  railX: number
  onCreate: () => void
}

/** The End rung: it closes the rails, and carries Create new rung as a full-width block on its wire. */
export const EndRung = ({ railX, onCreate }: EndRungProps) => {
  const isEditingLocked = useIsEditingLocked()
  const palette = useLadderThemePalette()
  const { gutter, gapBlk } = LADDER_STYLE
  const wireY = END_RUNG_HEIGHT / 2

  return (
    <div aria-label='Create new rung' className='relative w-full select-none' style={{ height: END_RUNG_HEIGHT }}>
      <RungGutter label='End' selected={false} wireTop={wireY} />
      <div className='absolute' style={{ left: gutter, top: 0, width: 2, height: '100%', background: palette.rail }} />
      <div
        className='absolute'
        style={{ left: gutter + railX, top: 0, width: 2, height: '100%', background: palette.rail }}
      />
      <div
        className='absolute'
        style={{ left: gutter, top: wireY, width: railX, height: 1, background: palette.wire }}
      />
      <button
        aria-label='Create new rung button'
        disabled={isEditingLocked}
        onClick={onCreate}
        className='absolute flex -translate-y-1/2 items-center justify-center gap-1 rounded-[3px] border border-dashed hover:border-brand disabled:cursor-not-allowed disabled:opacity-50'
        style={{
          left: gutter + gapBlk,
          top: wireY,
          width: Math.max(railX - 2 * gapBlk, 140),
          height: 24,
          background: palette.blockFill,
          borderColor: palette.wire,
          color: palette.muted,
          fontFamily: LADDER_TYPOGRAPHY.family,
          fontSize: LADDER_TYPOGRAPHY.nameSizePx,
        }}
      >
        <PlusIcon size='sm' className='stroke-current' />
        <span>Create new rung</span>
      </button>
    </div>
  )
}
