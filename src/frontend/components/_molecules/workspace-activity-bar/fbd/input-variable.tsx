import { ComponentPropsWithoutRef } from 'react'

import VariableInIcon from '../../../../assets/icons/project/fbd/VariableIn'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const InputVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Input variable'>
      <DragSource onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableInIcon size='md' />
      </DragSource>
    </ActivityBarButton>
  )
}
