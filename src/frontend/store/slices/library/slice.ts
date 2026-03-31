import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { LibrarySlice } from './types'

const createLibrarySlice: StateCreator<LibrarySlice, [], [], LibrarySlice> = (setState) => ({
  libraries: {
    system: [],
    user: [],
  },
  libraryActions: {
    setSystemLibraries: (libraries) => {
      setState(
        produce((state: LibrarySlice) => {
          state.libraries.system = libraries
        }),
      )
    },
    addLibrary: (libraryName, libraryType) => {
      setState(
        produce(({ libraries: { user: userLibraries } }: LibrarySlice) => {
          const libraryAlreadyExists = userLibraries.some((library) => library.name === libraryName)
          if (!libraryAlreadyExists) {
            userLibraries.push({ name: libraryName, type: libraryType })
          }
        }),
      )
    },
    updateLibraryName: (libraryName, newLibraryName) => {
      setState(
        produce(({ libraries: { user: userLibraries } }: LibrarySlice) => {
          const currentIndex = userLibraries.findIndex((lib) => lib.name === libraryName)
          if (currentIndex === -1) return

          const nextName = newLibraryName.trim()
          if (nextName.length === 0) return

          const conflictIndex = userLibraries.findIndex((lib) => lib.name === nextName)
          if (conflictIndex !== -1 && conflictIndex !== currentIndex) return

          userLibraries[currentIndex].name = nextName
        }),
      )
    },
    clearUserLibraries: () => {
      setState(
        produce((state: LibrarySlice) => {
          state.libraries.user = []
        }),
      )
    },
    removeUserLibrary: (libraryName) => {
      setState(
        produce(({ libraries: { user: userLibraries } }: LibrarySlice) => {
          const libraryIndex = userLibraries.findIndex((library) => library.name === libraryName)
          if (libraryIndex === -1) return
          userLibraries.splice(libraryIndex, 1)
        }),
      )
    },
  },
})

export { createLibrarySlice }
