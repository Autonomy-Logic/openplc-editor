import LoopIcon from '../../../../assets/icons/project/Loop'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { ComponentPropsWithoutRef } from 'react'

export const ParallelButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Loop'>
      <div draggable onDragStart={onDragStart}>
        <LoopIcon />
      </div>
    </ActivityBarButton>
  )
}
