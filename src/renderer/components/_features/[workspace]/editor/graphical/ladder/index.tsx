import { CreateRung } from '@root/renderer/components/_molecules/rung/create-rung'
import { Rung } from '@root/renderer/components/_organisms/rung'
import { useOpenPLCStore } from '@root/renderer/store'

import BlockElement from '../elements/block'
import CoilElement from '../elements/coil'
import ContactElement from '../elements/contact'

export default function LadderEditor() {
  const { rungs, flowActions } = useOpenPLCStore()

  const handleAddNewRung = () => {
    const defaultViewport: [number, number] = [1530, 250]

    flowActions.startLadderRung({
      rungId: rungs.length.toString(),
      defaultBounds: defaultViewport,
      flowViewport: defaultViewport,
    })
  }

  return (
    <div className='h-full w-full overflow-y-auto' style={{ scrollbarGutter: 'stable' }}>
      <div className='flex flex-1 flex-col gap-4 px-2'>
        {rungs.map((rung, index) => (
          <Rung key={index} id={index.toString()} rung={rung} />
        ))}
        <CreateRung onClick={handleAddNewRung} />
        <BlockElement />
        <ContactElement />
        <CoilElement />
      </div>
    </div>
  )
}
