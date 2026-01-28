import { consoleSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { formatTimestamp } from '@root/utils'
import { debounce } from 'lodash'
import { memo, useEffect, useMemo, useRef } from 'react'

import { LogComponent } from './log'

const Console = memo(() => {
  const logs = consoleSelectors.useLogs()
  const filters = useOpenPLCStore((state) => state.filters)
  const bottomLogRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const userScrolledRef = useRef(false)

  // Apply filters to logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Filter by level
      const level = log.level || 'info'
      if (!filters.levels[level]) return false

      // Filter by search term
      if (filters.searchTerm) {
        const searchLower = filters.searchTerm.toLowerCase()
        const messageMatch = log.message.toLowerCase().includes(searchLower)
        const timestampMatch = log.tstamp.toISOString().includes(searchLower)
        if (!messageMatch && !timestampMatch) return false
      }

      return true
    })
  }, [logs, filters])

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
  }, [filteredLogs])

  return (
    <div
      ref={containerRef}
      aria-label='Console'
      className='relative h-full w-full select-text overflow-auto text-cp-base font-semibold text-brand-dark focus:outline-none dark:text-neutral-50'
    >
      {filteredLogs.length > 0 &&
        filteredLogs.map((log) => (
          <LogComponent
            key={log.id}
            level={log.level}
            message={log.message}
            tstamp={formatTimestamp(log.tstamp, filters.timestampFormat)}
            searchTerm={filters.searchTerm}
          />
        ))}
      <div ref={bottomLogRef} id='bottom-log' />
    </div>
  )
})
export { Console }
