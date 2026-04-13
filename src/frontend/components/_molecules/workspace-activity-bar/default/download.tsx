import { DownloadIcon } from '../../../../assets/icons/interface/Download'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'

type DownloadButtonProps = { onClick?: () => void; disabled?: boolean; className?: string }

const DownloadButton = ({ onClick, disabled, className }: DownloadButtonProps) => {
  return (
    <ActivityBarButton aria-label='Download' onClick={onClick} disabled={disabled} className={className}>
      <DownloadIcon />
    </ActivityBarButton>
  )
}

export { DownloadButton }
