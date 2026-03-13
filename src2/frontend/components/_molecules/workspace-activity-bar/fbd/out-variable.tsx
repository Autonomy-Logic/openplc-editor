import VariableOutIcon from '../../../../assets/icons/project/fbd/VariableOut'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { ComponentPropsWithoutRef } from 'react'

export const OutVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Out variable'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableOutIcon size='md' />
      </div>
    </ActivityBarButton>
  )
}
