import CommentIcon from "@root/renderer/assets/icons/project/fbd/Comment"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

export const Comment = ({ onDragStart, onDragEnd }: ComponentPropsWithoutRef<'div'>) => {
  return (
    <ActivityBarButton aria-label='Comment'>
      <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <CommentIcon size="md" />
      </div>
    </ActivityBarButton>
  )
}
