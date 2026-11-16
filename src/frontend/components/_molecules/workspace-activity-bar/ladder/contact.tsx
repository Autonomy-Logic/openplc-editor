import { ComponentPropsWithoutRef } from 'react'

import ContactIcon from '../../../../assets/icons/project/ladder/Contact'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const ContactButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Contact'>
      <DragSource onDragStart={onDragStart}>
        <ContactIcon size='sm' />
      </DragSource>
    </ActivityBarButton>
  )
}
