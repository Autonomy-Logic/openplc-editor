import { create } from 'zustand'

import createPouSlice from './PouSlice'
import { PouSlice } from './types/PouSlice'

const OpenPlcEditorStore = create<PouSlice>()((...a) => ({
  ...createPouSlice(...a),
}))

export default OpenPlcEditorStore
