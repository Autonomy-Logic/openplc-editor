import { useOpenPLCStore } from '@root/renderer/store'
import { isV4Logs, RuntimeLogEntry, RuntimeLogLevel } from '@root/types/PLC/runtime-logs'
import { debounce } from 'lodash'
import { memo, useEffect, useMemo, useRef } from 'react'

import { LogComponent, LogLevel } from '../console/log'

const mapV4LevelToLogLevel = (level: RuntimeLogLevel): LogLevel => {
  switch (level) {
    case 'DEBUG':
      return 'debug'
    case 'INFO':
      return 'info'
    case 'WARNING':
      return 'warning'
    case 'ERROR':
      return 'error'
    default:
      return 'info'
  }
}

const PlcLogs = memo(() => {
  const plcLogs = useOpenPLCStore((state) => state.workspace.plcLogs)
  const bottomLogRef = useRef<HTMLDivElement | null>(null)

  const { isV4, v4Logs, v3LogLines } = useMemo(() => {
    if (isV4Logs(plcLogs)) {
      return { isV4: true, v4Logs: plcLogs, v3LogLines: [] as string[] }
    } else {
      const lines = plcLogs ? plcLogs.split('\n').filter((line: string) => line.trim() !== '') : []
      return { isV4: false, v4Logs: [] as RuntimeLogEntry[], v3LogLines: lines }
    }
  }, [plcLogs])

  const logCount = isV4 ? v4Logs.length : v3LogLines.length

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
  }, [logCount])

  return (
    <div
      aria-label='PLC Logs'
      className='relative h-full w-full overflow-auto text-cp-base font-semibold text-brand-dark focus:outline-none dark:text-neutral-50'
    >
      {isV4
        ? v4Logs.map((entry, index) => (
            <LogComponent
              key={`plc-log-v4-${entry.id ?? index}-${index}`}
              level={mapV4LevelToLogLevel(entry.level)}
              message={entry.message}
              tstamp={entry.timestamp}
            />
          ))
        : v3LogLines.length > 0 &&
          v3LogLines.map((line, index) => (
            <LogComponent key={`plc-log-v3-${index}-${line.slice(0, 50)}`} level='info' message={line} tstamp='' />
          ))}
      <div ref={bottomLogRef} id='bottom-log' />
    </div>
  )
})

export { PlcLogs }
