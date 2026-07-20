/**
 * Explain - This is a workaround to avoid the following error:
 * The ```@dnd-kit``` package is not correctly asserted by the lint tool.
 */
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useEffect, useState } from 'react'

import { useOpenPLCStore } from '../../../../../store'
import type { RungLadderState } from '../../../../../store/slices/ladder'
import { cn } from '../../../../../utils/cn'
import { RungBody } from '../../../../_molecules/graphical-editor/ladder/rung/body'
import { RungHeader } from '../../../../_molecules/graphical-editor/ladder/rung/header'

type RungProps = {
  className?: string
  index: number
  id: string
  rung: RungLadderState
  nodeDivergences?: string[]
  isDebuggerActive?: boolean
}

const Rung = ({ className, index, id, rung, nodeDivergences, isDebuggerActive }: RungProps) => {
  // Primitive selector: this per-rung component only needs the rung count of
  // its own flow (for the rounded-corner styling), so subscribe to just that.
  const rungsCount = useOpenPLCStore(
    (state) => state.ladderFlows.find((flow) => flow.rungs.some((r) => r.id === rung.id))?.rungs.length ?? 0,
  )
  const { updateModelLadder, getIsRungOpen } = useOpenPLCStore((state) => state.editorActions)

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })

  const [isOpen, setIsOpen] = useState<boolean>(true)

  const handleOpenSection = () => {
    setIsOpen(!isOpen)
    updateModelLadder({ openRung: { rungId: rung.id, open: !isOpen } })
  }

  useEffect(() => {
    updateModelLadder({ openRung: { rungId: rung.id, open: isOpen } })
  }, [])

  useEffect(() => {
    setIsOpen(getIsRungOpen({ rungId: rung.id }))
  }, [rung])

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <div
      aria-label='Rung container'
      className={cn('overflow w-full', className)}
      id={id}
      ref={setNodeRef}
      style={style}
      {...Object.entries(attributes).reduce((acc, [key, value]: [string, string]) => {
        if (key === 'tabIndex') return acc
        return { ...acc, [key]: value }
      }, {})}
    >
      <RungHeader
        onClick={handleOpenSection}
        isOpen={isOpen}
        rung={rung}
        draggableHandleProps={isDebuggerActive ? undefined : listeners}
        className={cn('border border-transparent', {
          'rounded-t-lg': index === 0,
          'rounded-b-lg': index === rungsCount - 1 && !isOpen,
        })}
      />
      {getIsRungOpen({ rungId: rung.id }) && (
        <RungBody
          rung={rung}
          className={cn('border border-transparent', {
            'rounded-b-lg': index === rungsCount - 1,
          })}
          nodeDivergences={nodeDivergences}
          isDebuggerActive={isDebuggerActive}
        />
      )}
    </div>
  )
}

const exportRung = memo(Rung)

export { exportRung as Rung }
