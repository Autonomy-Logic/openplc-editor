import VariableOutIcon from "@root/renderer/assets/icons/project/fbd/VariableOut"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

export const OutVariable = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Out variable'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <VariableOutIcon size="md" />
      </div>
    </ActivityBarButton>
  )
}
