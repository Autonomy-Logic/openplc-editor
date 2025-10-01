/**
 * Explain - This is a workaround to avoid the following error:
 * The ```@dnd-kit``` package is not correctly asserted by the lint tool.
 */
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { RungBody, RungHeader } from '@root/renderer/components/_molecules/graphical-editor/ladder/rung'
import { ladderSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungLadderState } from '@root/renderer/store/slices'
import { cn } from '@root/utils'

type RungProps = {
  className?: string
  index: number
  id: string
  rung: RungLadderState
  nodeDivergences?: string[]
}

export const Rung = ({ className, index, id, rung, nodeDivergences }: RungProps) => {
  const {
    ladderFlows,
    editorActions: { getIsRungOpen },
  } = useOpenPLCStore()

  const updateModelLadder = ladderSelectors.useUpdateModelLadder()

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })

  const flow = ladderFlows.find((flow) => {
    return flow.rungs.some((r) => r.id === rung.id)
  }) || { rungs: [] }

  const handleOpenSection = () => {
    const isOpen = getIsRungOpen({ rungId: rung.id })
    updateModelLadder({ openRung: { rungId: rung.id, open: !isOpen } })
  }

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }
  const handleRungIsOpen = () => {
    const isOpen = getIsRungOpen({ rungId: rung.id })
    if (isOpen === null) {
      updateModelLadder({ openRung: { rungId: rung.id, open: true } })
      return true
    }
    return isOpen
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
        isOpen={handleRungIsOpen()}
        rung={rung}
        draggableHandleProps={listeners}
        className={cn('border border-transparent', {
          'rounded-t-lg': index === 0,
          'rounded-b-lg': index === flow.rungs.length - 1 && !getIsRungOpen({ rungId: rung.id }),
        })}
      />
      {getIsRungOpen({ rungId: rung.id }) && (
        <RungBody
          rung={rung}
          className={cn('border border-transparent', {
            'rounded-b-lg': index === flow.rungs.length - 1,
          })}
          nodeDivergences={nodeDivergences}
        />
      )}
    </div>
  )
}
