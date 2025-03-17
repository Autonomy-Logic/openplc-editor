import VariableInIcon from "@root/renderer/assets/icons/project/fbd/VariableIn"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

export const InputVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Input variable'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableInIcon size="md" />
      </div>
    </ActivityBarButton>
  )
}
