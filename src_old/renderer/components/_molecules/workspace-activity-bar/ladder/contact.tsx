import ContactIcon from '@root/renderer/assets/icons/project/ladder/Contact'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { ComponentPropsWithoutRef } from 'react'

export const ContactButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Contact'>
      <div draggable onDragStart={onDragStart}>
        <ContactIcon size='sm' />
      </div>
    </ActivityBarButton>
  )
}
