import { ComponentPropsWithoutRef } from 'react'

import VariableInIcon from '../../../../assets/icons/project/fbd/VariableIn'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const InputVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Input variable'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableInIcon size='md' />
      </div>
    </ActivityBarButton>
  )
}
