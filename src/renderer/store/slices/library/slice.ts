/* eslint-disable @typescript-eslint/no-unsafe-call */
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
