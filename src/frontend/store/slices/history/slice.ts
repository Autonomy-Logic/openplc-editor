import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { HistorySlice, HistorySnapshot } from './types'

const HISTORY_LIMIT = 50

const createHistorySlice: StateCreator<HistorySlice, [], [], HistorySlice> = (setState) => ({
  history: {
    'default-history': {
      past: [],
      future: [],
      savedAtDepth: null,
    },
  },
  historyActions: {
    addPastHistory: (pouName: string, snapshot) => {
      setState(
        produce(({ history }: HistorySlice) => {
          if (history[pouName] === undefined) {
            history[pouName] = { past: [], future: [], savedAtDepth: null }
          }

          history[pouName].future = []
          history[pouName].past.push(snapshot)

          if (history[pouName].past.length > HISTORY_LIMIT) {
            history[pouName].past.shift()
          }
        }),
      )
    },
    addFutureHistory: (pouName: string, snapshot) => {
      setState(
        produce(({ history }: HistorySlice) => {
          if (history[pouName] === undefined) {
            history[pouName] = { past: [], future: [], savedAtDepth: null }
          }

          history[pouName].future.push(snapshot)
        }),
      )
    },
    popPastHistory: (pouName: string): HistorySnapshot | undefined => {
      let popped: HistorySnapshot | undefined

      setState(
        produce(({ history }: HistorySlice) => {
          if (history[pouName] === undefined) {
            history[pouName] = { past: [], future: [], savedAtDepth: null }
            popped = undefined
            return
          }

          const bucket = history[pouName]
          if (bucket.past.length === 0) {
            popped = undefined
            return
          }

          const last = bucket.past[bucket.past.length - 1]
          popped = JSON.parse(JSON.stringify(last)) as HistorySnapshot
          bucket.past.pop()
        }),
      )

      return popped
    },
    popFutureHistory: (pouName: string): HistorySnapshot | undefined => {
      let popped: HistorySnapshot | undefined

      setState(
        produce(({ history }: HistorySlice) => {
          if (history[pouName] === undefined) {
            history[pouName] = { past: [], future: [], savedAtDepth: null }
            popped = undefined
            return
          }

          const bucket = history[pouName]
          if (bucket.future.length === 0) {
            popped = undefined
            return
          }

          const last = bucket.future[bucket.future.length - 1]
          popped = JSON.parse(JSON.stringify(last)) as HistorySnapshot
          bucket.future.pop()
        }),
      )

      return popped
    },
    undo: (_pouName: string) => {},
    redo: (_pouName: string) => {},
    clearHistory: () => {
      setState(
        produce(({ history }: HistorySlice) => {
          for (const key of Object.keys(history)) {
            delete history[key]
          }
          history['default-history'] = {
            past: [],
            future: [],
            savedAtDepth: null,
          }
        }),
      )
    },
  },
})

export { createHistorySlice, HISTORY_LIMIT }
