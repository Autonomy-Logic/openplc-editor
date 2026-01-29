import { BroomIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@utils/cn'

type ClearConsoleButtonProps = {
  onClear?: () => void
  isEmpty?: boolean
  label?: string
}

const ClearConsoleButton = ({ onClear, isEmpty, label = 'Clear console' }: ClearConsoleButtonProps) => {
  const {
    consoleActions: { clearLogs },
    logs,
  } = useOpenPLCStore()

  const isDisabled = isEmpty ?? logs.length === 0
  const handleClear = onClear ?? clearLogs

  return (
    <button
      type='button'
      className={cn(
        'flex h-7 w-fit select-none items-center gap-1 rounded-lg bg-neutral-100 px-2 hover:bg-neutral-200 dark:bg-neutral-850 dark:hover:bg-neutral-900',
        isDisabled && 'cursor-not-allowed opacity-30 hover:bg-neutral-100 dark:hover:bg-neutral-850',
      )}
      onClick={handleClear}
      disabled={isDisabled}
    >
      <BroomIcon />
      <span className='font-caption text-cp-base font-normal'>{label}</span>
    </button>
  )
}
export { ClearConsoleButton }
