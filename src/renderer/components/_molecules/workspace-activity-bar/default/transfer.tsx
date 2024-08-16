import { TransferIcon } from "@root/renderer/assets"
import { ActivityBarButton } from "@root/renderer/components/_atoms/buttons"

export const TransferButton = () => {
  return (
    <ActivityBarButton aria-label='Transfer'>
      <TransferIcon />
    </ActivityBarButton>
  )
}
