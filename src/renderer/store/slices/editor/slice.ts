import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { IEditorData, IEditorSlice } from './types'

export const createEditorSlice: StateCreator<IEditorSlice, [], [], IEditorSlice> = (setState) => ({
  editor: {
    type: 'available',
  },
  editorActions: {
    setEditor: ({ editor }) =>
      setState(
        produce((state: IEditorData) => {
          state.editor = editor
        }),
      ),
    clearEditor: (): void =>
      setState(
        produce((state: IEditorData) => {
          state.editor = { type: 'available' }
        }),
      ),
  },
})
