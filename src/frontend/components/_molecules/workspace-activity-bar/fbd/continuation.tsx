import { ComponentPropsWithoutRef } from 'react'

import ContinuationIcon from '../../../../assets/icons/project/fbd/Continuation'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const Continuation = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Continuation'>
      <DragSource onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <ContinuationIcon size='md' />
      </DragSource>
    </ActivityBarButton>
  )
}
