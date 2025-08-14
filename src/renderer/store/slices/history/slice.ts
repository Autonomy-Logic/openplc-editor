import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { HistorySlice, HistorySnapshot } from './types'

const createHistorySlice: StateCreator<HistorySlice, [], [], HistorySlice> = (setState, _getState) => ({
  history: {
    'default-history': {
      past: [],
      future: [],
    },
  },
  historyActions: {
    addPastHistory: (pouName: string, snapshot) => {
      setState(
        produce(({ history }: HistorySlice) => {
          if (history[pouName] === undefined) {
            history[pouName] = {
              past: [],
              future: [],
            }
          }

          history[pouName].past.push(snapshot as unknown as HistorySnapshot)
        }),
      )
    },
    addFutureHistory: (pouName: string, snapshot) => {
      setState(
        produce(({ history }: HistorySlice) => {
          if (history[pouName] === undefined) {
            history[pouName] = {
              past: [],
              future: [],
            }
          }

          history[pouName].future.push(snapshot as unknown as HistorySnapshot)
        }),
      )
    },
    undo: (_pouName: string) => {},
    redo: (_pouName: string) => {},
  },
})

export { createHistorySlice }
