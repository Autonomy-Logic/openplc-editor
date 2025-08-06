import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { FileSlice } from './types'

export const createFileSlice: StateCreator<FileSlice, [], [], FileSlice> = (setState, getState) => ({
  files: {},

  fileActions: {
    addFile: (file) => {
      let returnValue = true // Default to true, will be set to false if file already exists
      setState(
        produce(({ files }: FileSlice) => {
          const existingFile = files[file.name]
          if (existingFile) {
            returnValue = false // File already exists, do not add again
            return
          }
          files[file.name] = {
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
        produce(({ files }: FileSlice) => {
          if (!files[name]) return
          delete files[name]
        }),
      )
    },
    updateFile: ({ name, saved }) => {
      setState(
        produce(({ files }: FileSlice) => {
          if (!files[name]) return

          const existingFile = files[name]
          existingFile.saved = saved
        }),
      )
    },
    getFile: ({ name }) => {
      const file = getState().files[name]
      if (!file) {
        console.warn(`File with name ${name} does not exist.`)
        return { file: undefined }
      }

      return {
        file,
      }
    },

    getSavedState: ({ name }) => {
      return getState().files[name]?.saved ?? false
    },
    checkIfAllFilesAreSaved: () => {
      const files = getState().files
      return Object.values(files).every((file) => file.saved)
    },

    clearFiles: () => {
      setState({
        files: {},
      })
    },
  },
})
