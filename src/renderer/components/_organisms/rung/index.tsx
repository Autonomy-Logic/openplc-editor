import { RungBody, RungHeader } from '@root/renderer/components/_molecules/rung'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungState } from '@root/renderer/store/slices'
import { useEffect, useState } from 'react'

type RungProps = {
  id: string
  rung: RungState
}

export const Rung = ({ id, rung }: RungProps) => {
  const {
    editorActions: { updateModelLadder, getIsRungOpen },
  } = useOpenPLCStore()

  const [isOpen, setIsOpen] = useState<boolean>(true)

  const handleOpenSection = () => {
    setIsOpen(!isOpen)
    updateModelLadder({ openRung: { rungId: rung.id, open: !isOpen } })
  }

  useEffect(() => {
    updateModelLadder({ openRung: { rungId: rung.id, open: isOpen } })
  }, [])

  useEffect(() => {
    setIsOpen(getIsRungOpen({ rungId: rung.id }))
  }, [rung])

  return (
    <div aria-label='Rung container' className='overflow w-full' id={id}>
      <RungHeader onClick={handleOpenSection} isOpen={isOpen} rung={rung} />
      {getIsRungOpen({ rungId: rung.id }) && <RungBody rung={rung} />}
    </div>
  )
}
