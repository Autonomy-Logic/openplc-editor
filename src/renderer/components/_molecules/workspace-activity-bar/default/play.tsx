import { PlayIcon } from "@root/renderer/assets"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"
import { ComponentPropsWithoutRef } from "react"

type PlayButtonProps = ComponentPropsWithoutRef<typeof ActivityBarButton>
export const PlayButton = (props: PlayButtonProps) => {
  return (
    <ActivityBarButton aria-label='Play' {...props}>
      <PlayIcon />
    </ActivityBarButton>
  )
}
