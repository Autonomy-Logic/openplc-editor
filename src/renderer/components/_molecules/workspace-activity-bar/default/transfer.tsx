import { TransferIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { useOpenPLCStore } from '@root/renderer/store'
import { parseProjectToXML } from '@root/utils/PLC/base-xml'

export const TransferButton = () => {
  const {
    project
  } = useOpenPLCStore()

  const buttonClick = () => {
    parseProjectToXML(project)
  }

  return (
    <ActivityBarButton aria-label='Transfer' onClick={buttonClick}>
      <TransferIcon />
    </ActivityBarButton>
  )
}
