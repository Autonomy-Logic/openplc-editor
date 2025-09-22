import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { ConsoleSlice, logObjectSchema } from './types'

const createConsoleSlice: StateCreator<ConsoleSlice, [], [], ConsoleSlice> = (setState) => ({
  logs: [],
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
  },
})

export { createConsoleSlice }
