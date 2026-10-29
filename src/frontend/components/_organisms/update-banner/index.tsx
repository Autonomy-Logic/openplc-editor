import type { AppUpdateStatus } from '../../../../middleware/shared/ports/app-update-port'
import { CloseIcon } from '../../../assets/icons/interface/Close'
import { cn } from '../../../utils/cn'

type ShownUpdate = Exclude<AppUpdateStatus, { state: 'none' }>

type UpdateBannerProps = {
  update: ShownUpdate
  onUpdate: () => void
  onDismiss: () => void
  className?: string
}

/** The banner's height, so the layout can make room for it below the title bar. */
export const UPDATE_BANNER_HEIGHT_CLASS = 'h-7'

function describe(update: ShownUpdate): { message: string; action: string | null } {
  switch (update.state) {
    case 'available':
      return { message: `A new version of OpenPLC Editor is available: ${update.version}`, action: 'Update' }
    case 'downloading':
      return { message: `Downloading OpenPLC Editor ${update.version}… ${update.percent}%`, action: null }
    case 'downloaded':
      return { message: `OpenPLC Editor ${update.version} is downloaded`, action: 'Open Installer' }
    default: {
      const unreachable: never = update
      return unreachable
    }
  }
}

/**
 * The thin bar across the top of the window that says a newer editor is out,
 * like Autonomy Edge's. Update downloads the installer and opens it; the X
 * hides the bar until the editor is opened again.
 */
export function UpdateBanner({ update, onUpdate, onDismiss, className }: UpdateBannerProps) {
  const { message, action } = describe(update)

  return (
    <div
      role='status'
      className={cn(
        'relative flex w-full items-center justify-center gap-3 bg-brand px-8 text-xs text-white',
        UPDATE_BANNER_HEIGHT_CLASS,
        className,
      )}
    >
      <span className='truncate'>{message}</span>
      {action && (
        <button
          type='button'
          onClick={onUpdate}
          className='shrink-0 rounded-sm bg-white px-2 py-0.5 text-xs font-medium text-brand transition-colors hover:bg-brand-light focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white'
        >
          {action}
        </button>
      )}
      <button
        type='button'
        onClick={onDismiss}
        aria-label='Dismiss'
        title='Hide until OpenPLC Editor is opened again'
        className='absolute right-2 flex h-5 w-5 items-center justify-center rounded-sm stroke-white hover:bg-brand-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white'
      >
        <CloseIcon className='h-3 w-3' />
      </button>
    </div>
  )
}
