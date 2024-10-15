import { TransferIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'

export const TransferButton = () => {
  const buttonClick = () => {
    console.log('PARSE TO XML')
  }

  return (
    <ActivityBarButton aria-label='Transfer' onClick={buttonClick}>
      <TransferIcon />
    </ActivityBarButton>
  )
}
