import BlockIcon from "@root/renderer/assets/icons/project/Block"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

export const BlockButton = ({ onDragStart }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Block'>
      <div draggable onDragStart={onDragStart}>
        <BlockIcon />
      </div>
    </ActivityBarButton>
  )
}
