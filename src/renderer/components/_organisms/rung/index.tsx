import { RungBody, RungHeader } from '@root/renderer/components/_molecules/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { FlowState } from '@root/renderer/store/slices'
import { useEffect, useState } from 'react'

import { customNodesStyles, nodesBuilder } from '../../_atoms/react-flow/custom-nodes'

type RungProps = {
  id: string
}

export const Rung = ({ id }: RungProps) => {
  const { rungs, flowActions } = useOpenPLCStore()

  const [isOpen, setIsOpen] = useState<boolean>(true)
  const [rung, setRung] = useState<FlowState>()

  useEffect(() => {
    findRung()
  }, [])

  const defaultBodyPanelExtent: [number, number] = [1530, 250]

  const findRung = () => {
    const rung = rungs.find((rung) => rung.id === id)
    if (rung) setRung(rung)
    else {
      const { powerRail } = customNodesStyles
      const newRung = {
        id,
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
            posX: defaultBodyPanelExtent[0] - powerRail.width,
            posY: 0,
            connector: 'left',
            handleX: defaultBodyPanelExtent[0] - powerRail.width,
            handleY: powerRail.height / 2,
          }),
        ],
        edges: [
          {
            id: 'e_left-rail_right-rail',
            source: 'left-rail',
            target: 'right-rail',
            type: 'step',
          },
        ],
      }
      flowActions.addRung(newRung)
      setRung(newRung)
    }
  }

  const handleOpenSection = () => {
    setIsOpen(!isOpen)
    findRung()
  }

  return (
    <div aria-label='Rung container' className='overflow w-full'>
      <RungHeader onClick={handleOpenSection} isOpen={isOpen} />
      {isOpen && rung && <RungBody rung={rung} defaultFlowPanelExtent={defaultBodyPanelExtent} />}
    </div>
  )
}
