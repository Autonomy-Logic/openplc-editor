import { ComponentPropsWithoutRef } from 'react'

import BlockIcon from '../../../../assets/icons/project/fbd/Block'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

export const BlockButton = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Block'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <BlockIcon size='md' />
      </div>
    </ActivityBarButton>
  )
}
