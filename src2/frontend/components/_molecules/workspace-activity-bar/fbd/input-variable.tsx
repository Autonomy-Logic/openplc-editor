import VariableInIcon from '../../../../assets/icons/project/fbd/VariableIn'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { ComponentPropsWithoutRef } from 'react'

export const InputVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Input variable'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableInIcon size='md' />
      </div>
    </ActivityBarButton>
  )
}
