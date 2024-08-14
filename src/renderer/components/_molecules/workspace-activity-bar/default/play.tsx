import { PlayIcon } from "@root/renderer/assets"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"

export const PlayButton = () => {
  return (
    <ActivityBarButton aria-label='Play'>
      <PlayIcon />
    </ActivityBarButton>
  )
}
