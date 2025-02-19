 
import {
  AdditionalFunctionBlocks,
  ArduinoFunctionBlocks,
  Arithmetic,
  BitShift,
  Bitwise,
  CharacterString,
  CommunicationBlocks,
  Comparison,
  Jaguar,
  MQTT,
  Numerical,
  P1AM,
  Selection,
  SequentMicrosystemsModules,
  StandardFunctionBlocks,
  Time,
  TypeConversion,
} from '@process:renderer/data/library'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { LibrarySlice } from './type'

const createLibrarySlice: StateCreator<LibrarySlice, [], [], LibrarySlice> = (setState) => ({
  libraries: {
    system: [
      AdditionalFunctionBlocks,
      ArduinoFunctionBlocks,
      CommunicationBlocks,
      Jaguar,
      MQTT,
      P1AM,
      SequentMicrosystemsModules,
      StandardFunctionBlocks,
      Arithmetic,
      BitShift,
      Bitwise,
      CharacterString,
      Comparison,
      Numerical,
      Selection,
      Time,
      TypeConversion,
    ],
    user: [],
  },
  /**
   * TODO: Create and implement the logic for the functions below
   */
  libraryActions: {
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
    clearUserLibraries: () => {
      setState(
        produce((slice: LibrarySlice) => {
          slice.libraries.user = []
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
