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
export interface LibrarySliceAdd {
  pouWasCreated: boolean
  addLibraryToUser: (pou: unknown) => void
}

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
    user: ['TEST'],
  },
  /**
   * TODO: Create and implement the logic for the functions below
   */
  libraryActions: {
    addLibrary: (libraryName) => {
      setState(
        produce(({ libraries }: LibrarySlice) => {
          if (!libraries.user.includes(libraryName)) {
            libraries.user.push(libraryName)
          }
        }),
      )
    },
    addLibraryToUser: (pou: string) => {
      setState((state) => ({
        libraries: {
          ...state.libraries,
          user: [...state.libraries.user, pou],
        },
        pouWasCreated: true,
      }))
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
