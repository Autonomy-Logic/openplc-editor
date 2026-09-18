import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { hasAnsi, parseAnsi, stripAnsi } from '../../../utils/terminal-output'
import type { ConsoleSlice, LogEntry } from './types'

/**
 * Split any SGR colour off the raw text.
 *
 * Every log lands here, so this is the one place that has to know escapes
 * exist: `message` is always clean text, and `segments` carries the styling
 * only when there was any. Uncoloured logs (the overwhelming majority) keep
 * the exact shape they had before and allocate nothing extra.
 */
function normalizeLogEntry(log: LogEntry): LogEntry {
  if (!hasAnsi(log.message)) return log
  return { ...log, message: stripAnsi(log.message), segments: parseAnsi(log.message) }
}

/**
 * Entry ids are React keys for one in-memory list, nothing more: the store is
 * never persisted, and no code outside the console renderer reads an id. A
 * sequence is therefore both sufficient and better than a UUID — it can't
 * collide, costs nothing, and reads legibly in a test failure. It deliberately
 * does NOT reset on `clearLogs`, so a cleared line can never share a key with
 * a later one while React still holds the old nodes.
 */
let logSequence = 0
const nextLogId = () => `log-${++logSequence}`

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
          // A carriage-return redraw overwrites the in-place line a terminal
          // would still have the cursor on, instead of stacking another
          // entry. That collapses a whole download's worth of progress
          // frames into one live-updating line.
          const lastIndex = state.logs.length - 1
          const overwritten = options?.redraw && state.logs[lastIndex]?.transient ? state.logs[lastIndex] : undefined

          const entry = normalizeLogEntry({
            ...log,
            // A redraw keeps the replaced line's id so React updates that node
            // in place rather than unmounting and remounting it on every
            // progress frame.
            id: overwritten?.id ?? nextLogId(),
            tstamp: log.tstamp ?? new Date(),
          })

          if (overwritten) {
            state.logs[lastIndex] = entry
            return
          }
          state.logs.push(entry)
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
