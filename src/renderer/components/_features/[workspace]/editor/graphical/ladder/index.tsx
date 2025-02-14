/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  closestCenter,
  defaultDropAnimation,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CreateRung } from '@root/renderer/components/_molecules/rung/create-rung'
import { Rung } from '@root/renderer/components/_organisms/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungState, zodFlowSchema } from '@root/renderer/store/slices'
import { cn } from '@root/utils'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'

export default function LadderEditor() {
  const {
    flows,
    editor,
    flowActions,
    searchNodePosition,
    projectActions: { updatePou },
    workspaceActions: { setEditingState },
  } = useOpenPLCStore()

  const flow = flows.find((flow) => flow.name === editor.meta.name)
  const rungs = flow?.rungs || []
  const flowUpdated = flow?.updated

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [activeItem, setActiveItem] = useState<RungState | null>(null)

  const scrollableRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollableRef.current) {
      scrollableRef.current.scrollTo({
        top: searchNodePosition.y,
        left: searchNodePosition.x,
        behavior: 'smooth',
      })
    }
  }, [searchNodePosition])

  /**
   * Update the flow state to project JSON
   */
  useEffect(() => {
    if (!flowUpdated) return

    const flowSchema = zodFlowSchema.safeParse(flow)
    if (!flowSchema.success) return

    updatePou({
      name: editor.meta.name,
      content: {
        language: 'ld',
        value: flowSchema.data,
      },
    })

    /**
     * TODO: Verify if this is method is declared
     */
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    flowActions.setFlowUpdated({ editorName: editor.meta.name, updated: false })
    setEditingState('unsaved')
  }, [flowUpdated === true])

  const getRungPos = (rungId: UniqueIdentifier) => rungs.findIndex((rung) => rung.id === rungId)

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    setActiveId(active.id)
    setActiveItem(rungs.find((rung) => rung.id === active.id) || null)
  }

  const handleAddNewRung = () => {
    const defaultViewport: [number, number] = [300, 100]
    flowActions.startLadderRung({
      editorName: editor.meta.name,
      rungId: `rung_${editor.meta.name}_${uuidv4()}`,
      defaultBounds: defaultViewport,
      flowViewport: defaultViewport,
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    setActiveId(null)
    setActiveItem(null)

    if (!flow) {
      console.error('Flow is undefined')
      return
    }

    if (!active || !over) {
      console.error('Active or over is undefined')
      return
    }

    if (active.id === over.id) return

    const sourceIndex = getRungPos(active.id)
    const destinationIndex = getRungPos(over.id)

    if (
      sourceIndex < 0 ||
      destinationIndex < 0 ||
      sourceIndex >= flow.rungs.length ||
      destinationIndex >= flow.rungs.length
    ) {
      console.error('Invalid source or destination index')
      return
    }

    const auxRungs = [...(flow?.rungs || [])]
    // Store the original state for recovery
    const originalRungs = [...auxRungs]
    const [removed] = auxRungs.splice(sourceIndex, 1)
    auxRungs.splice(destinationIndex, 0, removed)

    console.log('Rungs:', auxRungs)

    try {
      flowActions.setRungs({ editorName: editor.meta.name, rungs: auxRungs })
    } catch (error) {
      console.error('Failed to update rungs:', error)
      // Recover the original state
      flowActions.setRungs({ editorName: editor.meta.name, rungs: originalRungs })
      // Notify the user
      console.error('Failed to reorder rungs. The operation has been reverted.')
    }
  }

  return (
    <div className='h-full w-full overflow-y-auto' ref={scrollableRef} style={{ scrollbarGutter: 'stable' }}>
      <div className='flex flex-1 flex-col gap-4 px-2'>
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
          <div
            className={cn({
              'h-fit rounded-lg border dark:border-neutral-800': rungs.length > 0,
            })}
          >
            <SortableContext items={rungs} strategy={verticalListSortingStrategy}>
              {rungs.map((rung, index) => (
                <Rung
                  key={rung.id}
                  id={rung.id}
                  index={index}
                  rung={rung}
                  className={cn({
                    'opacity-35': activeId === rung.id,
                  })}
                />
              ))}
            </SortableContext>
            {createPortal(
              <DragOverlay dropAnimation={defaultDropAnimation}>
                {activeId && activeItem ? (
                  <Rung key={activeItem.id} id={activeItem.id} rung={activeItem} index={-1} />
                ) : null}
              </DragOverlay>,
              document.body,
            )}
          </div>
        </DndContext>
        <CreateRung onClick={handleAddNewRung} />
      </div>
    </div>
  )
}
