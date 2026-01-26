import { consoleSelectors } from '@root/renderer/hooks'
import { formatTimestamp } from '@root/utils'
import { debounce } from 'lodash'
import { memo, useEffect, useRef } from 'react'

import { LogComponent } from './log'

const Console = memo(() => {
  const logs = consoleSelectors.useLogs()
  const bottomLogRef = useRef<HTMLDivElement | null>(null)

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
  }, [logs])
  return (
    <div
      aria-label='Console'
      className='relative h-full w-full select-text overflow-auto text-cp-base font-semibold text-brand-dark focus:outline-none dark:text-neutral-50'
    >
      {logs.length > 0 &&
        logs.map((log) => (
          <LogComponent key={log.id} level={log.level} message={log.message} tstamp={formatTimestamp(log.tstamp)} />
        ))}
      <div ref={bottomLogRef} id='bottom-log' />
    </div>
  )
})
export { Console }
