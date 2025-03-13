import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

export const InOutVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Input variable'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <span> INOUT. VAR </span>
      </div>
    </ActivityBarButton>
  )
}
