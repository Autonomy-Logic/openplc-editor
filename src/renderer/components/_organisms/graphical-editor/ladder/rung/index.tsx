/**
 * Explain - This is a workaround to avoid the following error:
 * The ```@dnd-kit``` package is not correctly asserted by the lint tool.
 */
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { RungBody, RungHeader } from '@root/renderer/components/_molecules/graphical-editor/ladder/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungLadderState } from '@root/renderer/store/slices'
import { cn } from '@root/utils'
import { useEffect, useState } from 'react'

type RungProps = {
  className?: string
  index: number
  id: string
  rung: RungLadderState
}

export const Rung = ({ className, index, id, rung }: RungProps) => {
  const {
    ladderFlows,
    editorActions: { updateModelLadder, getIsRungOpen },
  } = useOpenPLCStore()

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })

  const [isOpen, setIsOpen] = useState<boolean>(true)
  const flow = ladderFlows.find((flow) => flow.rungs.some((r) => r.id === rung.id)) || { rungs: [] }

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
        draggableHandleProps={listeners}
        className={cn('border border-transparent', {
          'rounded-t-lg': index === 0,
          'rounded-b-lg': index === flow.rungs.length - 1 && !isOpen,
        })}
      />
      {getIsRungOpen({ rungId: rung.id }) && (
        <RungBody
          rung={rung}
          className={cn('border border-transparent', {
            'rounded-b-lg': index === flow.rungs.length - 1,
          })}
        />
      )}
    </div>
  )
}
