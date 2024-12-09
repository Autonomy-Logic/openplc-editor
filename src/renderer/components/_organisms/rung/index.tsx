import { Draggable } from '@hello-pangea/dnd'
import { RungBody, RungHeader } from '@root/renderer/components/_molecules/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungState } from '@root/renderer/store/slices'
import { cn } from '@root/utils'
import { useEffect, useState } from 'react'

type RungProps = {
  index: number
  id: string
  rung: RungState
}

export const Rung = ({ index, id, rung }: RungProps) => {
  const {
    flows,
    editorActions: { updateModelLadder, getIsRungOpen },
  } = useOpenPLCStore()

  const [isOpen, setIsOpen] = useState<boolean>(true)
  const flow = flows.find((flow) => flow.rungs.includes(rung)) || { rungs: [] }

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

  return (
    <Draggable draggableId={rung.id} index={index}>
      {(provided) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          aria-label='Rung container'
          className='overflow w-full'
          id={id}
          style={{ ...provided.draggableProps.style }}
        >
          <RungHeader
            onClick={handleOpenSection}
            isOpen={isOpen}
            rung={rung}
            draggableHandleProps={provided.dragHandleProps}
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
      )}
    </Draggable>
  )
}
