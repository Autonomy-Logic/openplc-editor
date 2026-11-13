import { ComponentPropsWithoutRef } from 'react'

import VariableOutIcon from '../../../../assets/icons/project/fbd/VariableOut'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const OutVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Out variable'>
      <DragSource onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableOutIcon size='md' />
      </DragSource>
    </ActivityBarButton>
  )
}
