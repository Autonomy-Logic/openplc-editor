import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { EditorSlice, EditorState } from './types'

export const createEditorSlice: StateCreator<EditorSlice, [], [], EditorSlice> = (setState, getState) => ({
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
        }),
      ),
    removeModel: (name) =>
      setState(
        produce((state: EditorState) => {
          state.editors = state.editors.filter((model) => model.meta.name !== name)
        }),
      ),
    updateModelVariables: (_name, variables) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state
          if (!editor || !(editor.type === 'plc-textual' || editor.type === 'plc-graphical')) return
          editor.variable = variables
        }),
      ),

    setEditor: (newEditor) =>
      setState(
        produce((state: EditorState) => {
          /**
           * Update the editor state if exists at editors
           */
          const oldEditor = getState().editor
          if (oldEditor.type !== 'available') {
            state.editors = state.editors.map((model) => {
              if (model.meta.name === oldEditor.meta.name) {
                return oldEditor
              }
              return model
            })
          }
          state.editor = newEditor
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
      return getState().editors.find((model) => model.meta.name === name) ?? null
    },
  },
})
