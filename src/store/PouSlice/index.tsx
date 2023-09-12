/* eslint-disable @typescript-eslint/no-explicit-any */
import { CONSTANTS } from '@shared/constants'
import { StateCreator } from 'zustand'

const { types, languages } = CONSTANTS

type Store = {
  pouData: {
    name?: string
    type: (typeof types)[keyof typeof types]
    language?: (typeof languages)[keyof typeof languages]
    body?: string
  }
  setPouData: (data: {
    name?: string
    type: (typeof types)[keyof typeof types]
    language?: (typeof languages)[keyof typeof languages]
    body?: string
  }) => void
  updateBody: (body: string | undefined) => void
}

const pouSlice: StateCreator<Store> = (set) => ({
  pouData: {
    name: '',
    type: '',
    language: '',
    body: '',
  },
  setPouData: (data) => set((state) => ({ ...state.pouData, pouData: data })),
  updateBody: (body) =>
    set((state) => ({ ...state, pouData: { ...state.pouData, body } })),
})

export default pouSlice
