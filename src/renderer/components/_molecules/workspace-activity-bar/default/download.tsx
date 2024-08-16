import { DownloadIcon } from "@root/renderer/assets"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"

export const DownloadButton = () => {
  return (
    <ActivityBarButton aria-label='Download'>
      <DownloadIcon />
    </ActivityBarButton>
  )
}
