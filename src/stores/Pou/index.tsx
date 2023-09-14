import { StateCreator } from 'zustand'

import { PouSlice } from '../types/PouSlice'

const createPouSlice: StateCreator<PouSlice> = (set) => ({
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

export default createPouSlice
