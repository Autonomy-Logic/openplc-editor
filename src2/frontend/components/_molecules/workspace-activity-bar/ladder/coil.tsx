import CoilIcon from '../../../../assets/icons/project/ladder/Coil'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { ComponentPropsWithoutRef } from 'react'

export const CoilButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Coil'>
      <div draggable onDragStart={onDragStart}>
        <CoilIcon />
      </div>
    </ActivityBarButton>
  )
}
