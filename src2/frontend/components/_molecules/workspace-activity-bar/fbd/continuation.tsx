import ContinuationIcon from '../../../../assets/icons/project/fbd/Continuation'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { ComponentPropsWithoutRef } from 'react'

export const Continuation = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Continuation'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <ContinuationIcon size='md' />
      </div>
    </ActivityBarButton>
  )
}
