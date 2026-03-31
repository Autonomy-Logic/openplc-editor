import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { FileSlice } from './types'

export const createFileSlice: StateCreator<FileSlice, [], [], FileSlice> = (setState, getState) => ({
  files: {},

  fileActions: {
    setFiles: ({ files }) => {
      setState(
        produce(({ files: currentFiles }: FileSlice) => {
          Object.assign(currentFiles, files)
        }),
      )
    },
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
            isNew: file.isNew ?? false, // Track if this is a newly created file
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
    updateFile: ({ name, saved, filePath, newName, isNew }) => {
      setState(
        produce(({ files }: FileSlice) => {
          if (!files[name]) return

          const existingFile = files[name]
          existingFile.saved = saved ?? existingFile.saved
          existingFile.filePath = filePath ?? existingFile.filePath
          if (isNew !== undefined) {
            existingFile.isNew = isNew
          }

          if (newName) {
            if (files[newName]) return

            const dir = existingFile.filePath.substring(0, existingFile.filePath.lastIndexOf('/'))
            const newFilePath = `${dir}/${newName.includes('.') ? newName : `${newName}.json`}`
            files[newName] = { ...existingFile, filePath: newFilePath }
            delete files[name]
          }
        }),
      )
    },
    getFile: ({ name }) => {
      const file = getState().files[name]
      if (!file) {
        return { file: undefined }
      }

      return {
        file,
      }
    },

    setAllToSaved: () => {
      setState(
        produce(({ files }: FileSlice) => {
          Object.keys(files).forEach((key) => {
            files[key].saved = true
          })
        }),
      )
    },
    setAllToUnsaved: () => {
      setState(
        produce(({ files }: FileSlice) => {
          Object.keys(files).forEach((key) => {
            files[key].saved = false
          })
        }),
      )
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
