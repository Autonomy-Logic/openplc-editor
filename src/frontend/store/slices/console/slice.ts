import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { hasAnsi, parseAnsi, stripAnsi } from '../../../utils/terminal-output'
import type { ConsoleSlice, LogEntry } from './types'

/**
 * Splits any SGR colour off the raw text: `message` becomes clean text and `segments` carries the styling. A log with
 * no escape is returned unchanged.
 */
function normalizeLogEntry(log: LogEntry): LogEntry {
  if (!hasAnsi(log.message)) return log
  return { ...log, message: stripAnsi(log.message), segments: parseAnsi(log.message) }
}

/** The sequence behind log entry ids, the Console list's React keys; `clearLogs` does not reset it. */
let logSequence = 0
const nextLogId = () => `log-${++logSequence}`

const createConsoleSlice: StateCreator<ConsoleSlice, [], [], ConsoleSlice> = (setState, getState) => ({
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
  logsAwaitingProject: [],
  projectConsoleOpen: false,
  consoleActions: {
    addLog: (log, options) => {
      setState(
        produce((state: ConsoleSlice) => {
          const lastIndex = state.logs.length - 1
          const overwritten = options?.redraw && state.logs[lastIndex]?.transient ? state.logs[lastIndex] : undefined

          const entry = normalizeLogEntry({
            ...log,
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
    addLogWhenProjectOpen: (log) => {
      if (getState().projectConsoleOpen) {
        getState().consoleActions.addLog(log)
        return
      }
      setState(
        produce((state: ConsoleSlice) => {
          state.logsAwaitingProject.push({ ...log, tstamp: log.tstamp ?? new Date() })
        }),
      )
    },
    openProjectConsole: () => {
      const kept = getState().logsAwaitingProject
      setState(
        produce((state: ConsoleSlice) => {
          state.projectConsoleOpen = true
          state.logsAwaitingProject = []
        }),
      )
      for (const log of kept) {
        getState().consoleActions.addLog(log)
      }
    },
    closeProjectConsole: () => {
      setState(
        produce((state: ConsoleSlice) => {
          state.projectConsoleOpen = false
        }),
      )
    },
  },
})

export { createConsoleSlice }
