import { ComponentPropsWithoutRef } from 'react'

import VariableInOutIcon from '../../../../assets/icons/project/fbd/VariableInOut'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const InOutVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='InOut variable'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableInOutIcon size='md' />
      </div>
    </ActivityBarButton>
  )
}
