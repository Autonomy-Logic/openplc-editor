import { RungBody, RungHeader } from '@root/renderer/components/_molecules/rung'
import { PropsWithChildren, useState } from 'react'

export const Rung = ({ children }: PropsWithChildren) => {
  const [isOpen, setIsOpen] = useState(false)
  const handleOpenSection = () => {
    setIsOpen(!isOpen)
  }
  return (
    <div aria-label='Rung container' className='w-full'>
      <RungHeader onClick={handleOpenSection} isOpen={isOpen} />
      {isOpen && <RungBody>{children}</RungBody>}
    </div>
  )
}
