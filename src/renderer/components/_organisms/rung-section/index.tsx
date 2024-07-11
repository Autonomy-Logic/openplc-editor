import { RungSectionBody, RungSectionHeader } from '@components/_molecules/rung-section'
import { PropsWithChildren, useState } from 'react'

export const RungSection = ({ children }: PropsWithChildren) => {
  const [isOpen, setIsOpen] = useState(false)
  const handleOpenSection = () => {
    setIsOpen(!isOpen)
  }
  return (
    <div aria-label='Rung section container' className='w-full'>
      <RungSectionHeader onClick={handleOpenSection} isOpen={isOpen} />
      {isOpen && <RungSectionBody>{children}</RungSectionBody>}
    </div>
  )
}
