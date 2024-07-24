import { RungBody, RungHeader } from '@root/renderer/components/_molecules/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { FlowState } from '@root/renderer/store/slices'
import { useState } from 'react'

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
      const newRung = {
        id,
        nodes: [
          {
            id: '1',
            position: { x: 0, y: 0 },
            data: { label: 'Node 1' },
            measured: { width: 150, height: 40 },
          },
          {
            id: '2',
            position: { x: 1350, y: 160 },
            data: { label: 'Node 2' },
            measured: { width: 150, height: 40 },
          },
        ],
        edges: [],
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
