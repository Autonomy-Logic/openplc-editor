import { ComponentPropsWithoutRef } from 'react'

import LoopIcon from '../../../../assets/icons/project/Loop'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const ParallelButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Loop'>
      <DragSource onDragStart={onDragStart}>
        <LoopIcon />
      </DragSource>
    </ActivityBarButton>
  )
}
