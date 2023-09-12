/* eslint-disable @typescript-eslint/no-explicit-any */
import { CONSTANTS } from '@shared/constants'
import { create } from 'zustand'

const { types, languages } = CONSTANTS
import pouSlice from './PouSlice/index'

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

const OpenPlcEditorStore = create<Store>()((...a) => ({
  ...pouSlice(...a),
}))

export default OpenPlcEditorStore
