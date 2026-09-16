import { CodeIcon } from '../../../assets/icons/interface/CodeIcon'
import { TableIcon } from '../../../assets/icons/interface/TableIcon'
import { cn } from '../../../utils/cn'

type ViewMode = 'table' | 'code'

type ViewModeToggleProps = {
  display: ViewMode
  onDisplayChange: (display: ViewMode) => void
  containerLabel: string
  tableLabel: string
  codeLabel: string
  className?: string
}

const ViewModeToggle = ({
  display,
  onDisplayChange,
  containerLabel,
  tableLabel,
  codeLabel,
  className,
}: ViewModeToggleProps) => {
  return (
    <div
      aria-label={containerLabel}
      className={cn('flex h-fit w-fit items-center justify-center rounded-md', className)}
    >
      <button
        type='button'
        aria-label={tableLabel}
        aria-pressed={display === 'table'}
        onClick={() => onDisplayChange('table')}
        className='flex rounded-l-md hover:cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand'
      >
        <TableIcon
          size='md'
          currentVisible={display === 'table'}
          className={cn(
            display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
            'rounded-l-md transition-colors ease-in-out',
          )}
        />
      </button>

      <button
        type='button'
        aria-label={codeLabel}
        aria-pressed={display === 'code'}
        onClick={() => onDisplayChange('code')}
        className='flex rounded-r-md hover:cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand'
      >
        <CodeIcon
          size='md'
          currentVisible={display === 'code'}
          className={cn(
            display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
            'rounded-r-md transition-colors ease-in-out',
          )}
        />
      </button>
    </div>
  )
}

export { ViewModeToggle }
export type { ViewMode }
