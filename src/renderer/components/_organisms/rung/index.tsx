import { RungBody, RungHeader } from '@root/renderer/components/_molecules/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { FlowState } from '@root/renderer/store/slices'
import { useState } from 'react'

import { customNodesStyles, nodesBuilder } from '../../_atoms/react-flow/custom-nodes'

type RungProps = {
  id: string
}

export const Rung = ({ id }: RungProps) => {
  const [isOpen, setIsOpen] = useState<boolean>(false)

  const { rungs, flowActions } = useOpenPLCStore()
  const [rung, setRung] = useState<FlowState>({
    id,
    nodes: [],
    edges: [],
  })

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
            posX: 1500 - powerRail.width,
            posY: 0,
            connector: 'left',
            handleX: 1500 - powerRail.width,
            handleY: powerRail.height / 2,
          }),
        ],
        edges: [
          {
            id: 'e1-2',
            source: 'left-rail',
            target: 'right-rail',
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
      {isOpen && <RungBody rung={rung} />}
    </div>
  )
}
