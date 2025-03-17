import VariableInOutIcon from "@root/renderer/assets/icons/project/fbd/VariableInOut"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

export const InOutVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='InOut variable'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableInOutIcon size="md" />
      </div>
    </ActivityBarButton>
  )
}
