import { DownloadIcon } from '../../../../assets'
import { ActivityBarButton } from '../../../_atoms/buttons'

type DownloadButtonProps = { onClick?: () => void }

const DownloadButton = ({ onClick }: DownloadButtonProps) => {
  return (
    <ActivityBarButton aria-label='Download' onClick={onClick}>
      <DownloadIcon />
    </ActivityBarButton>
  )
}

export { DownloadButton }
