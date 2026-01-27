import { BroomIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@utils/cn'

const ClearConsoleButton = () => {
  const {
    consoleActions: { clearLogs },
    logs,
  } = useOpenPLCStore()
  return (
    <button
      type='button'
      className={cn(
        'flex h-7 w-fit select-none items-center gap-1 rounded-lg bg-neutral-100 px-2 hover:bg-neutral-200 dark:bg-neutral-850 dark:hover:bg-neutral-900',
        logs.length === 0 && 'cursor-not-allowed opacity-30 hover:bg-neutral-100 dark:hover:bg-neutral-850',
      )}
      onClick={clearLogs}
      disabled={logs.length === 0}
    >
      <BroomIcon />
      <span className='font-caption text-cp-base font-normal'>Clear console</span>
    </button>
  )
}
export { ClearConsoleButton }
