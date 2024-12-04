import { TrashCanIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { ComponentPropsWithoutRef } from 'react'

export const TrashCanButton = (props: ComponentPropsWithoutRef<'button'>) => {
  const { onClick, className, ...rest } = props
  return (
    <ActivityBarButton aria-label='TrashCanButton' onClick={onClick} className={className} {...rest}>
      <TrashCanIcon className='h-5 w-5 stroke-[#B4D1FE]' />
    </ActivityBarButton>
  )
}
