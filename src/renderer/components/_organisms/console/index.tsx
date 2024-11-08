import { useOpenPLCStore } from '@root/renderer/store'

import { LogComponent } from './log'

const Console = () => {
  const {
    logs,
    consoleActions: { addLog },
  } = useOpenPLCStore()
  return (
    <div className='flex h-full w-full flex-col gap-1 rounded-lg border-[0.75px] border-neutral-200 p-2 dark:border-neutral-800 dark:bg-neutral-900'>
      <div
        aria-label='Console'
        className='h-full w-full overflow-auto text-cp-base font-semibold text-brand-dark dark:text-neutral-50'
      >
        {logs.length > 0 && logs.map((log) => <LogComponent key={log.id} type={log.type} message={log.message} />)}
      </div>
      <button
        type='button'
        className='text-cp-base font-semibold text-brand-dark dark:text-neutral-50'
        onClick={() => addLog({ id: Date.now().toString(), type: 'info', message: 'New log' })}
      >
        Add log
      </button>
    </div>
  )
}
export { Console }
