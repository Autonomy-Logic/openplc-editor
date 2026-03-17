import BlockIcon from '@root/renderer/assets/icons/project/ladder/Block'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { ComponentPropsWithoutRef } from 'react'

export const BlockButton = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Block'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <BlockIcon />
      </div>
    </ActivityBarButton>
  )
}
