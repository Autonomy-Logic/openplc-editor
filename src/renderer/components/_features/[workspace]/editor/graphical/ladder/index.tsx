import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd'
import { CreateRung } from '@root/renderer/components/_molecules/rung/create-rung'
import { Rung } from '@root/renderer/components/_organisms/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { zodFlowSchema } from '@root/renderer/store/slices'
import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

export default function LadderEditor() {
  const {
    flows,
    editor,
    flowActions,
    projectActions: { updatePou },
  } = useOpenPLCStore()

  const flow = flows.find((flow) => flow.name === editor.meta.name)
  const flowUpdated = flow?.updated

  const [rungs, setRungs] = useState(flow?.rungs || [])

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
  }, [flowUpdated === true])

  useEffect(() => {
    setRungs(flow?.rungs || [])
  }, [flow?.rungs])

  const handleAddNewRung = () => {
    const defaultViewport: [number, number] = [1530, 250]
    flowActions.startLadderRung({
      editorName: editor.meta.name,
      rungId: `rung_${editor.meta.name}_${uuidv4()}`,
      defaultBounds: defaultViewport,
      flowViewport: defaultViewport,
    })
  }

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return

    const sourceIndex = result.source.index
    const destinationIndex = result.destination.index

    const auxRungs = [...(flow?.rungs || [])]
    const [removed] = auxRungs.splice(sourceIndex, 1)
    auxRungs.splice(destinationIndex, 0, removed)

    flowActions.setRungs({ editorName: editor.meta.name, rungs: auxRungs })
  }

  return (
    <div className='h-full w-full overflow-y-auto' style={{ scrollbarGutter: 'stable' }}>
      <div className='flex flex-1 flex-col gap-4 px-2'>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId='rungs' type='list' direction='vertical'>
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className='h-fit rounded-lg border dark:border-neutral-800'
              >
                {rungs.map((rung, index) => (
                  <Rung key={rung.id} id={rung.id} index={index} rung={rung} />
                ))}
              </div>
            )}
          </Droppable>
        </DragDropContext>
        <CreateRung onClick={handleAddNewRung} />
      </div>
    </div>
  )
}
