import { ComponentPropsWithoutRef } from 'react'

import CommentIcon from '../../../../assets/icons/project/fbd/Comment'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { DragSource } from '../../drag-source'

export const Comment = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Comment'>
      <DragSource onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <CommentIcon size='md' />
      </DragSource>
    </ActivityBarButton>
  )
}
