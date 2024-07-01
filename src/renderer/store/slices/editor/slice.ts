import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { EditorSlice, EditorState } from './types'

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> = (setState) => ({
  editor: [],
  editorActions: {
    addModel: (editor) =>
      setState(
        produce((state: EditorState) => {
          const model = state.editor.find((model) => model.meta.name === editor.meta.name)
          if (model) return
          state.editor.push(editor)
        }),
      ),
    removeModel: (name) =>
      setState(
        produce((state: EditorState) => {
          state.editor = state.editor.filter((model) => model.meta.name !== name)
        }),
      ),
    updateModelVariables: (name, variables) =>
      setState(
        produce((state: EditorState) => {
          const model = state.editor.find((model) => model.meta.name === name)
          if (model && (model.type === 'plc-textual' || model.type === 'plc-graphical')) model.variable = variables
          return
        }),
      ),
    clearEditor: (): void =>
      setState(
        produce((state: EditorState) => {
          state.editor = []
        }),
      ),
  },
})
