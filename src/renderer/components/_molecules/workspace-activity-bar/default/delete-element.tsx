import { CloseFilledIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { ComponentPropsWithoutRef } from 'react'

export const DeleteElementButton = (props: ComponentPropsWithoutRef<'button'>) => {
  const { onClick, className, ...rest } = props
  return (
    <ActivityBarButton aria-label='Delete element button' onClick={onClick} className={className} {...rest}>
      <CloseFilledIcon />
    </ActivityBarButton>
  )
}
