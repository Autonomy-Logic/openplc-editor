import {
  AdditionalFunctionBlocks,
  ArduinoFunctionBlocks,
  CommunicationBlocks,
  Jaguar,
  MQTT,
  P1AM,
  SequentMicrosystemsModules,
  StandardFunctionBlocks,
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
    ],
    user: [],
  },
  /**
   * TODO: Create and implement the logic for the functions below
   */
  libraryActions: {
    addLibrary: (libraryName) => {
      setState(
        produce(({ libraries }: LibrarySlice) => {
          libraries.user.push(libraryName)
        }),
      )
    },
    removeLibrary: (libraryName) => {
      setState(
        produce(({ libraries }: LibrarySlice) => {
          libraries.user = libraries.user.filter((library) => library !== libraryName)
        }),
      )
    },
  },
})

export { createLibrarySlice }
