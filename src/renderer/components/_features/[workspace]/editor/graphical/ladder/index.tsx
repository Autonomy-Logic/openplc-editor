import { CreateRung } from '@root/renderer/components/_molecules/rung/create-rung'
import { Rung } from '@root/renderer/components/_organisms/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'

export default function LadderEditor() {
  const { flows, editor, flowActions } = useOpenPLCStore()

  const handleAddNewRung = () => {
    const defaultViewport: [number, number] = [1530, 250]

    console.log('editor.meta.name', editor.meta.name)

    flowActions.startLadderRung({
      editorName: editor.meta.name,
      rungId: `rung_${editor.meta.name}_${uuidv4()}`,
      defaultBounds: defaultViewport,
      flowViewport: defaultViewport,
    })
  }

  useEffect(() => {
    console.log('FLOWS')
    console.log(flows)
  }, [flows])

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
