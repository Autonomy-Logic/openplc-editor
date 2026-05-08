import { ComponentPropsWithoutRef } from 'react'

import ContinuationIcon from '../../../../assets/icons/project/fbd/Continuation'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const Continuation = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Continuation'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <ContinuationIcon size='md' />
      </div>
    </ActivityBarButton>
  )
}
