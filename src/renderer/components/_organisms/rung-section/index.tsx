import { RungSectionBody, RungSectionHeader } from '@components/_molecules/rung-section'
import { useState } from 'react'

export const RungSection = () => {
  const [isOpen, setIsOpen] = useState(false)
  const handleOpenSection = () => {
    setIsOpen(!isOpen)
  }
  return (
    <div className='w-full'>
      <RungSectionHeader onClick={handleOpenSection} isOpen={isOpen} />
      {isOpen && <RungSectionBody />}
    </div>
  )
}
