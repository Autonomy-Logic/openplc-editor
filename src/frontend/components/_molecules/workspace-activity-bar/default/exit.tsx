import { ComponentPropsWithoutRef } from 'react'

import { CloseFilledIcon } from '../../../../assets/icons/interface/Close'
import { StickArrowIcon } from '../../../../assets/icons/interface/StickArrow'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const ExitButton = ({ onClick }: ComponentPropsWithoutRef<'button'>) => {
  return (
    <ActivityBarButton aria-label='Exit' onClick={onClick}>
      <StickArrowIcon direction='left' className='stroke-[#B4D0FE]' />
    </ActivityBarButton>
  )
}

export const DeleteElementButton = (props: ComponentPropsWithoutRef<'button'>) => {
  const { onClick, className, ...rest } = props
  return (
    <ActivityBarButton aria-label='Delete element button' onClick={onClick} className={className} {...rest}>
      <CloseFilledIcon />
    </ActivityBarButton>
  )
}
