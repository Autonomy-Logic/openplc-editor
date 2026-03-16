import { ComponentPropsWithoutRef } from 'react'

import LoopIcon from '../../../../assets/icons/project/Loop'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const ParallelButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Loop'>
      <div draggable onDragStart={onDragStart}>
        <LoopIcon />
      </div>
    </ActivityBarButton>
  )
}
