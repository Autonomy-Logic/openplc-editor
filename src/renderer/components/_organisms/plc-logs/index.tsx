import { useOpenPLCStore } from '@root/renderer/store'
import { isV4Logs, RuntimeLogEntry, RuntimeLogLevel } from '@root/types/PLC/runtime-logs'
import { formatTimestamp } from '@root/utils'
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
  const filters = useOpenPLCStore((state) => state.workspace.plcFilters)
  const bottomLogRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const userScrolledRef = useRef(false)
  const v3LogKeysRef = useRef<Map<number, string>>(new Map())

  const { isV4, _v4Logs, v4DisplayLogs, v3LogLines } = useMemo(() => {
    if (isV4Logs(plcLogs)) {
      // Apply filters to v4 logs
      const filteredLogs = plcLogs.filter((entry) => {
        // Filter by level
        const level = mapV4LevelToLogLevel(entry.level)
        if (!filters.levels[level]) return false

        // Filter by search term
        if (filters.searchTerm) {
          const searchLower = filters.searchTerm.toLowerCase()
          const messageMatch = entry.message.toLowerCase().includes(searchLower)
          const timestampMatch = entry.timestamp.toLowerCase().includes(searchLower)
          if (!messageMatch && !timestampMatch) return false
        }

        return true
      })

      return { isV4: true, _v4Logs: plcLogs, v4DisplayLogs: filteredLogs, v3LogLines: [] as string[] }
    } else {
      const lines = plcLogs ? plcLogs.split('\n').filter((line: string) => line.trim() !== '') : []

      // Apply search filter to v3 logs
      const filteredLines = filters.searchTerm
        ? lines.filter((line) => line.toLowerCase().includes(filters.searchTerm.toLowerCase()))
        : lines

      return {
        isV4: false,
        _v4Logs: [] as RuntimeLogEntry[],
        v4DisplayLogs: [] as RuntimeLogEntry[],
        v3LogLines: filteredLines,
      }
    }
  }, [plcLogs, filters])

  const logCount = isV4 ? v4DisplayLogs.length : v3LogLines.length

  // Generate stable UUIDs for v3 log lines
  const getV3LogKey = (index: number): string => {
    if (!v3LogKeysRef.current.has(index)) {
      v3LogKeysRef.current.set(index, crypto.randomUUID())
    }
    return v3LogKeysRef.current.get(index)!
  }

  // Handle scroll to detect if user has scrolled away from bottom
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
      userScrolledRef.current = !isAtBottom
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    // Only auto-scroll if user is at the bottom (terminal-like behavior)
    if (userScrolledRef.current) return

    const debouncedScrollToBottomLog = debounce(
      () => {
        if (bottomLogRef.current) {
          bottomLogRef.current.scrollIntoView({
            behavior: 'instant',
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
      ref={containerRef}
      aria-label='PLC Logs'
      className='relative h-full w-full select-text overflow-auto text-cp-base font-semibold text-brand-dark focus:outline-none dark:text-neutral-50'
    >
      {isV4
        ? v4DisplayLogs.map((entry, index) => (
            <LogComponent
              key={`plc-log-v4-${entry.id ?? index}-${index}`}
              level={mapV4LevelToLogLevel(entry.level)}
              message={entry.message}
              tstamp={formatTimestamp(entry.timestamp, filters.timestampFormat)}
              searchTerm={filters.searchTerm}
            />
          ))
        : v3LogLines.length > 0 &&
          v3LogLines.map((line, index) => (
            <LogComponent
              key={getV3LogKey(index)}
              level='info'
              message={line}
              tstamp=''
              searchTerm={filters.searchTerm}
            />
          ))}
      <div ref={bottomLogRef} id='bottom-log' />
    </div>
  )
})

export { PlcLogs }
