import { ComponentPropsWithoutRef } from 'react'

import BlockIcon from '../../../../assets/icons/project/ladder/Block'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const BlockButton = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Block'>
      <DragSource onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <BlockIcon />
      </DragSource>
    </ActivityBarButton>
  )
}
