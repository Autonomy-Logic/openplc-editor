import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { PrintSlice } from './types'

const initialPrintState: PrintSlice['print'] = {
  selectedPouNames: [],
  renderMode: 'normal',
  pagePolicy: 'new-page-per-pou',
  pageSetup: {
    size: 'a4',
    orientation: 'portrait',
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
  },
}

const createPrintSlice: StateCreator<PrintSlice, [], [], PrintSlice> = (setState) => ({
  print: { ...initialPrintState },

  printActions: {
    togglePou: (name) => {
      setState(
        produce(({ print }: PrintSlice) => {
          const index = print.selectedPouNames.indexOf(name)
          if (index === -1) {
            print.selectedPouNames.push(name)
          } else {
            print.selectedPouNames.splice(index, 1)
          }
        }),
      )
    },

    selectAllPous: (names) => {
      setState(
        produce(({ print }: PrintSlice) => {
          print.selectedPouNames = [...names]
        }),
      )
    },

    clearPouSelection: () => {
      setState(
        produce(({ print }: PrintSlice) => {
          print.selectedPouNames = []
        }),
      )
    },

    setRenderMode: (renderMode) => {
      setState(
        produce(({ print }: PrintSlice) => {
          print.renderMode = renderMode
        }),
      )
    },

    setPagePolicy: (pagePolicy) => {
      setState(
        produce(({ print }: PrintSlice) => {
          print.pagePolicy = pagePolicy
        }),
      )
    },

    setPageSetup: (patch) => {
      setState(
        produce(({ print }: PrintSlice) => {
          print.pageSetup = { ...print.pageSetup, ...patch }
        }),
      )
    },

    resetPrintSelection: () => {
      setState(
        produce((state: PrintSlice) => {
          state.print = { ...initialPrintState }
        }),
      )
    },
  },
})

export { createPrintSlice }
