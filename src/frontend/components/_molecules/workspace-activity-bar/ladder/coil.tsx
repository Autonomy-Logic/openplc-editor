import { ComponentPropsWithoutRef } from 'react'

import CoilIcon from '../../../../assets/icons/project/ladder/Coil'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const CoilButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Coil'>
      <DragSource onDragStart={onDragStart}>
        <CoilIcon />
      </DragSource>
    </ActivityBarButton>
  )
}
