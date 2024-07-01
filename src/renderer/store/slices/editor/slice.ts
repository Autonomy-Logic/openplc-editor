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
          console.log('editor added', state.editors.map((model) => model))
        }),
      ),
    removeModel: (name) =>
      setState(
        produce((state: EditorState) => {
          state.editors = state.editors.filter((model) => model.meta.name !== name)
          console.log('editor removed', state.editors.map((model) => model))
        }),
      ),
    updateModelVariables: (name, variables) =>
      setState(
        produce((state: EditorState) => {
          const model = state.editors.find((model) => model.meta.name === name)
          if (model && (model.type === 'plc-textual' || model.type === 'plc-graphical')) {
            model.variable = variables
            console.log('editor updated', state.editors.map((model) => model))
            return
          }
          console.log('editor not updated', state.editors.map((model) => model))
        }),
      ),

    setEditor: (editor) =>
      setState(
        produce((state: EditorState) => {
          state.editor = editor
          console.log('editor set', editor)
        }),
      ),
    clearEditor: () =>
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

    getEditorFromEditors: (name) => {
      let candidate = null
      produce((state: EditorState) => {
        candidate = state.editors.find((model) => model.meta.name === name)
      })
      return candidate
    },
  },
})
