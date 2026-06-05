import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { FileSlice } from './types'

const createFileSlice: StateCreator<FileSlice, [], [], FileSlice> = (setState, getState) => ({
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
      let returnValue = true
      setState(
        produce(({ files }: FileSlice) => {
          if (files[file.name]) {
            returnValue = false
            return
          }
          files[file.name] = {
            type: file.type,
            filePath: file.filePath,
            saved: true,
            isNew: file.isNew,
            cleanState: file.cleanState,
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
    updateFile: ({ name, saved, filePath, newName, isNew, cleanState }) => {
      setState(
        produce(({ files }: FileSlice) => {
          if (!files[name]) return

          const existingFile = files[name]
          existingFile.saved = saved ?? existingFile.saved
          existingFile.filePath = filePath ?? existingFile.filePath
          if (isNew !== undefined) existingFile.isNew = isNew
          if (cleanState !== undefined) existingFile.cleanState = cleanState

          if (newName) {
            if (files[newName]) return

            const lastSlashIndex = existingFile.filePath.lastIndexOf('/')
            const dir = lastSlashIndex !== -1 ? existingFile.filePath.substring(0, lastSlashIndex) : ''
            const newFileName = newName.includes('.') ? newName : `${newName}.json`
            const newFilePath = dir ? `${dir}/${newFileName}` : newFileName
            files[newName] = { ...existingFile, filePath: newFilePath }
            delete files[name]
          }
        }),
      )
    },
    getFile: ({ name }) => {
      const file = getState().files[name]
      return { file: file ?? undefined }
    },

    setAllToSaved: () => {
      setState(
        produce(({ files }: FileSlice) => {
          for (const key of Object.keys(files)) {
            files[key].saved = true
          }
        }),
      )
    },
    setAllToUnsaved: () => {
      setState(
        produce(({ files }: FileSlice) => {
          for (const key of Object.keys(files)) {
            files[key].saved = false
          }
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
      setState({ files: {} })
    },
  },
})

export { createFileSlice }
