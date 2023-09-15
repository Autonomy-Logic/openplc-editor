import { createStore } from 'zustand'

import createPouSlice from './Pou'
// import createProjectSlice from './Project'
import { PouSlice } from './types/PouSlice'

const OpenPlcEditorStore = createStore<PouSlice & unknown>()((...a) => ({
  ...createPouSlice(...a),
  /// ...createProjectSlice(...a),
}))

export default OpenPlcEditorStore
