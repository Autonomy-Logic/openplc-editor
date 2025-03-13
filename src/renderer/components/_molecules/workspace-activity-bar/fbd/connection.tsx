import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

export const Connection = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Input variable'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <span> Connection </span>
      </div>
    </ActivityBarButton>
  )
}
