import { RungBody, RungHeader } from '@root/renderer/components/_molecules/rung'
import { useState } from 'react'

export const Rung = () => {
  const [isOpen, setIsOpen] = useState<boolean>(false)

  const handleOpenSection = () => {
    setIsOpen(!isOpen)
  }

  return (
    <div aria-label='Rung container' className='w-full'>
      <RungHeader onClick={handleOpenSection} isOpen={isOpen} />
      {isOpen && <RungBody />}
    </div>
  )
}
