import { DownloadIcon } from '../../../../assets/icons/interface/Download'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

type DownloadButtonProps = { onClick?: () => void }

const DownloadButton = ({ onClick }: DownloadButtonProps) => {
  return (
    <ActivityBarButton aria-label='Download' onClick={onClick}>
      <DownloadIcon />
    </ActivityBarButton>
  )
}

export { DownloadButton }
