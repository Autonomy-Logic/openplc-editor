import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { FileSlice } from './types'

export const createFBDFlowSlice: StateCreator<FileSlice, [], [], FileSlice> = (setState, getState) => ({
  data: {},

  actions: {
    addFile: (file) => {
      let returnValue = true // Default to true, will be set to false if file already exists
      setState(
        produce(({ data }: FileSlice) => {
          const existingFile = data[file.name]
          if (existingFile) {
            returnValue = false // File already exists, do not add again
            return
          }
          data[file.name] = {
            type: file.type,
            filePath: file.filePath,
            saved: true, // Default to true when adding a new file
          }
        }),
      )
      return returnValue
    },
    removeFile: ({ name }) => {
      setState(
        produce(({ data }: FileSlice) => {
          if (!data[name]) return
          delete data[name]
        }),
      )
    },
    updateFile: ({ name, saved }) => {
      setState(
        produce(({ data }: FileSlice) => {
          if (!data[name]) return

          const existingFile = data[name]
          existingFile.saved = saved
        }),
      )
    },

    getSavedState: ({ name }) => {
      return getState().data[name]?.saved ?? false
    },
    checkIfAllFilesAreSaved: () => {
      const files = getState().data
      return Object.values(files).every((file) => file.saved)
    },

    resetFiles: () => {
      setState({
        data: {},
      })
    },
  },
})
