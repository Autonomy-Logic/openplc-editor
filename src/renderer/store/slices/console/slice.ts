import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { ConsoleSlice, logObjectSchema } from './types'

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
  consoleActions: {
    addLog: (log) => {
      const parsed = logObjectSchema.parse(log)
      setState(
        produce((state: ConsoleSlice) => {
          state.logs.push(parsed)
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
  },
})

export { createConsoleSlice }
