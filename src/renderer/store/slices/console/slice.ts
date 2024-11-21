import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { ConsoleSlice } from './types'

const createConsoleSlice: StateCreator<ConsoleSlice, [], [], ConsoleSlice> = (setState) => ({
  logs: [],
  consoleActions: {
    addLog: (log) => {
      setState(
        produce((state: ConsoleSlice) => {
          state.logs.push(log)
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
