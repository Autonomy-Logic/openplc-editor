import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { LogObject } from '../../../../middleware/shared/ports/types'
import { hasAnsi, parseAnsi, stripAnsi } from '../../../utils/terminal-output'
import type { ConsoleSlice } from './types'

/**
 * Split any SGR colour off the raw text.
 *
 * Every log lands here, so this is the one place that has to know escapes
 * exist: `message` is always clean text, and `segments` carries the styling
 * only when there was any. Uncoloured logs (the overwhelming majority) keep
 * the exact shape they had before and allocate nothing extra.
 */
function normalizeLogEntry(log: LogObject): LogObject {
  if (!hasAnsi(log.message)) return log
  return { ...log, message: stripAnsi(log.message), segments: parseAnsi(log.message) }
}

const createConsoleSlice: StateCreator<ConsoleSlice, [], [], ConsoleSlice> = (setState) => ({
  logs: [],
  filters: {
    levels: {
      debug: true,
      info: true,
      warning: true,
      error: true,
    },
    searchTerm: '',
    timestampFormat: 'full',
  },
  followRequestId: 0,
  consoleActions: {
    addLog: (log, options) => {
      setState(
        produce((state: ConsoleSlice) => {
          const entry = normalizeLogEntry({
            ...log,
            tstamp: log.tstamp ?? new Date(),
          })

          // A carriage-return redraw overwrites the in-place line a terminal
          // would still have the cursor on, instead of stacking another
          // entry. That collapses a whole download's worth of progress
          // frames into one live-updating line.
          const lastIndex = state.logs.length - 1
          if (options?.redraw && state.logs[lastIndex]?.transient) {
            state.logs[lastIndex] = entry
            return
          }
          state.logs.push(entry)
        }),
      )
    },
    removeLog: (id) => {
      setState(
        produce((state: ConsoleSlice) => {
          state.logs = state.logs.filter((log) => log.id !== id)
        }),
      )
    },
    clearLogs: () => {
      setState(
        produce((state: ConsoleSlice) => {
          state.logs = []
        }),
      )
    },
    setLevelFilter: (level, enabled) => {
      setState(
        produce((state: ConsoleSlice) => {
          state.filters.levels[level] = enabled
        }),
      )
    },
    setSearchTerm: (term) => {
      setState(
        produce((state: ConsoleSlice) => {
          state.filters.searchTerm = term
        }),
      )
    },
    setTimestampFormat: (format) => {
      setState(
        produce((state: ConsoleSlice) => {
          state.filters.timestampFormat = format
        }),
      )
    },
    requestConsoleFollow: () => {
      setState(
        produce((state: ConsoleSlice) => {
          state.followRequestId += 1
        }),
      )
    },
  },
})

export { createConsoleSlice }
