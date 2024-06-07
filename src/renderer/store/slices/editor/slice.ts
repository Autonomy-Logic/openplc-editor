import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { EditorSlice, EditorState } from './types'

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> = (setState) => ({
  editor: {
    type: 'available',
    meta: {
      name: 'name as string',
    },
  },
  editorActions: {
    setEditor: ({ editor }) =>
      setState(
        produce((state: EditorState) => {
          state.editor = editor
        }),
      ),
    clearEditor: (): void =>
      setState(
        produce((state: EditorState) => {
          state.editor = { type: 'available', meta: { name: 'name as string' } }
        }),
      ),
  },
})
