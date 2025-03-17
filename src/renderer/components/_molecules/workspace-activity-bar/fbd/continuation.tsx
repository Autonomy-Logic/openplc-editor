import ContinuationIcon from "@root/renderer/assets/icons/project/fbd/Continuation"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

export const Continuation = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Continuation'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <ContinuationIcon size="md" />
      </div>
    </ActivityBarButton>
  )
}
