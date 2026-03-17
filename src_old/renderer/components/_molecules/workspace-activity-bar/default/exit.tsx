import { StickArrowIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { ComponentPropsWithoutRef } from 'react'

export const ExitButton = ({ onClick }: ComponentPropsWithoutRef<'button'>) => {
  return (
    <ActivityBarButton aria-label='Exit' onClick={onClick}>
      <StickArrowIcon direction='left' className='stroke-[#B4D0FE]' />
    </ActivityBarButton>
  )
}
