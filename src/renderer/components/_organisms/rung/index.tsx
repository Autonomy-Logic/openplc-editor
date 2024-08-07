import { RungBody, RungHeader } from '@root/renderer/components/_molecules/rung'
import { FlowState } from '@root/renderer/store/slices'
import { useState } from 'react'


type RungProps = {
  id: string
  rung: FlowState
}

export const Rung = ({ id, rung }: RungProps) => {
  const [isOpen, setIsOpen] = useState<boolean>(true)

  const handleOpenSection = () => {
    setIsOpen(!isOpen)
  }

  return (
    <div aria-label='Rung container' className='overflow w-full' id={id}>
      <RungHeader onClick={handleOpenSection} isOpen={isOpen} />
      {isOpen && <RungBody rung={rung} />}
    </div>
  )
}
