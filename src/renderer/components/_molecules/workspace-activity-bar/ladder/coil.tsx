import CoilIcon from '@root/renderer/assets/icons/project/Coil'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { ComponentPropsWithoutRef } from 'react'

export const CoilButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Coil'>
      <div draggable onDragStart={onDragStart}>
        <CoilIcon />
      </div>
    </ActivityBarButton>
  )
}
