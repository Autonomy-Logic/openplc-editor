import ConnectorIcon from "@root/renderer/assets/icons/project/fbd/Connector"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

export const Connector = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Connector'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <ConnectorIcon size="md" />
      </div>
    </ActivityBarButton>
  )
}
