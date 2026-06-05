import { ComponentPropsWithoutRef } from 'react'

import CommentIcon from '../../../../assets/icons/project/fbd/Comment'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const Comment = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Comment'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <CommentIcon size='md' />
      </div>
    </ActivityBarButton>
  )
}
