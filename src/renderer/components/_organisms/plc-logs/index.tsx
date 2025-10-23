import { useOpenPLCStore } from '@root/renderer/store'
import { debounce } from 'lodash'
import { memo, useEffect, useRef } from 'react'

import { LogComponent } from '../console/log'

const PlcLogs = memo(() => {
  const plcLogs = useOpenPLCStore((state) => state.workspace.plcLogs)
  const bottomLogRef = useRef<HTMLDivElement | null>(null)

  const logLines = plcLogs ? plcLogs.split('\n').filter((line) => line.trim() !== '') : []

  useEffect(() => {
    const debouncedScrollToBottomLog = debounce(
      () => {
        if (bottomLogRef.current) {
          bottomLogRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'end',
            inline: 'end',
          })
        }
      },
      75,
      { leading: false, trailing: true },
    )
    debouncedScrollToBottomLog()
    return () => {
      debouncedScrollToBottomLog.cancel()
    }
  }, [logLines.length])

  return (
    <div
      aria-label='PLC Logs'
      className='relative h-full w-full overflow-auto text-cp-base font-semibold text-brand-dark focus:outline-none dark:text-neutral-50'
    >
      {logLines.length > 0 &&
        logLines.map((line, index) => <LogComponent key={`plc-log-${index}`} level='info' message={line} tstamp='' />)}
      <div ref={bottomLogRef} id='bottom-log' />
    </div>
  )
})

export { PlcLogs }
