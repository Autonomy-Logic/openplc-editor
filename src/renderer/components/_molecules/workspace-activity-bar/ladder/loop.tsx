import LoopIcon from '@root/renderer/assets/icons/project/Loop'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { ComponentPropsWithoutRef } from 'react'

export const LoopButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Loop'>
      <div draggable onDragStart={onDragStart}>
        <LoopIcon />
      </div>
    </ActivityBarButton>
  )
}
