import { customNodesStyles, nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
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
    const { powerRail } = customNodesStyles

    flowActions.addRung({
      id: rungs.length.toString(),
      defaultBounds: defaultViewport,
      flowViewport: defaultViewport,
      nodes: [
        nodesBuilder.powerRail({
          id: 'left-rail',
          posX: 0,
          posY: 0,
          connector: 'right',
          handleX: powerRail.width,
          handleY: powerRail.height / 2,
        }),
        nodesBuilder.powerRail({
          id: 'right-rail',
          posX: 1530 - powerRail.width,
          posY: 0,
          connector: 'left',
          handleX: defaultViewport[0] - powerRail.width,
          handleY: powerRail.height / 2,
        }),
      ],
      edges: [
        {
          id: 'e_left-rail_right-rail',
          source: 'left-rail',
          target: 'right-rail',
          sourceHandle: 'left-rail',
          targetHandle: 'right-rail',
          type: 'step',
        },
      ],
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
