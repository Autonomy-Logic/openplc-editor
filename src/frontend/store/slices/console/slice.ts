import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { ConsoleSlice } from './types'

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
    addLog: (log) => {
      setState(
        produce((state: ConsoleSlice) => {
          state.logs.push({
            ...log,
            tstamp: log.tstamp ?? new Date(),
          })
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
