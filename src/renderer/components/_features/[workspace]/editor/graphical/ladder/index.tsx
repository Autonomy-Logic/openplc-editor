import { CreateRung } from '@root/renderer/components/_molecules/rung/create-rung'
import { Rung } from '@root/renderer/components/_organisms/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { zodFlowSchema } from '@root/renderer/store/slices'
import { useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'

export default function LadderEditor() {
  const {
    flows,
    editor,
    flowActions,
    projectActions: { updatePou },
  } = useOpenPLCStore()

  /**
   * Update the flow state to project JSON
   */
  useEffect(() => {
    const flow = flows.find((flow) => flow.name === editor.meta.name)
    if (!flow) return

    const flowSchema = zodFlowSchema.safeParse(flow)
    if (!flowSchema.success) return

    updatePou({
      name: editor.meta.name,
      content: {
        language: 'ld',
        value: flowSchema.data,
      },
    })
  }, [flows.find((flow) => flow.name === editor.meta.name)])

  const handleAddNewRung = () => {
    const defaultViewport: [number, number] = [1530, 250]
    flowActions.startLadderRung({
      editorName: editor.meta.name,
      rungId: `rung_${editor.meta.name}_${uuidv4()}`,
      defaultBounds: defaultViewport,
      flowViewport: defaultViewport,
    })
  }

  return (
    <div className='h-full w-full overflow-y-auto' style={{ scrollbarGutter: 'stable' }}>
      <div className='flex flex-1 flex-col gap-4 px-2'>
        {flows
          .find((flow) => flow.name === editor.meta.name)
          ?.rungs.map((rung, index) => <Rung key={index} id={index.toString()} rung={rung} />)}
        <CreateRung onClick={handleAddNewRung} />
      </div>
    </div>
  )
}
