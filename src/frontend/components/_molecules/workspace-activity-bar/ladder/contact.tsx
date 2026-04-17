import { ComponentPropsWithoutRef } from 'react'

import ContactIcon from '../../../../assets/icons/project/ladder/Contact'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const ContactButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Contact'>
      <div draggable onDragStart={onDragStart}>
        <ContactIcon size='sm' />
      </div>
    </ActivityBarButton>
  )
}
