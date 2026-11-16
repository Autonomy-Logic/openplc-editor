import { ComponentPropsWithoutRef } from 'react'

import VariableInOutIcon from '../../../../assets/icons/project/fbd/VariableInOut'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const InOutVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='InOut variable'>
      <DragSource onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableInOutIcon size='md' />
      </DragSource>
    </ActivityBarButton>
  )
}
