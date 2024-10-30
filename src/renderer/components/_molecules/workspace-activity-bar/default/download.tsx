import { DownloadIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { useOpenPLCStore } from '@root/renderer/store'
import { parseProjectToXML } from '@root/utils/PLC/base-xml'

export const DownloadButton = () => {
  const { project } = useOpenPLCStore()

  const buttonClick = () => {
    parseProjectToXML(project)
  }
  return (
    <ActivityBarButton aria-label='Download' onClick={buttonClick}>
      <DownloadIcon />
    </ActivityBarButton>
  )
}
