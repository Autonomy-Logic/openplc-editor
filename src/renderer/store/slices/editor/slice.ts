import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { EditorSlice, EditorState } from './types'

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> = (setState) => ({
  editors: [],

  editor: {
    type: 'available',
    meta: {
      name: 'available',
    },
  },

  editorActions: {
    addModel: (editor) =>
      setState(
        produce((state: EditorState) => {
          const model = state.editors.find((model) => model.meta.name === editor.meta.name)
          if (model) return
          state.editors.push(editor)
          if (state.editor.type === 'available') state.editor = editor
        }),
      ),
    removeModel: (name) =>
      setState(
        produce((state: EditorState) => {
          state.editors = state.editors.filter((model) => model.meta.name !== name)
        }),
      ),
    updateModelVariables: (name, variables) =>
      setState(
        produce((state: EditorState) => {
          const model = state.editors.find((model) => model.meta.name === name)
          if (model && (model.type === 'plc-textual' || model.type === 'plc-graphical')) model.variable = variables
          return
        }),
      ),

    setEditor: (editor) =>
      setState(
        produce((state: EditorState) => {
          state.editor = editor
        }),
      ),
    clearEditor: (): void =>
      setState(
        produce((state: EditorState) => {
          state.editors = []
          state.editor = {
            type: 'available',
            meta: {
              name: 'available',
            },
          }
        }),
      ),
  },
})
