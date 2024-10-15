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
    updateModelVariables: (variables) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state

          if (editor.type === 'plc-resource') {
            if (variables.display === 'table') {
              if (editor.variable.display === 'table') {
                editor.variable = {
                  display: 'table',
                  selectedRow: variables.selectedRow?.toString() ?? editor.variable.selectedRow ?? '-1',
                  description: variables.description ?? editor.variable.description ?? '',
                }
              } else {
                editor.variable = {
                  display: 'table',
                  selectedRow: variables.selectedRow?.toString() ?? '-1',
                  description: variables.description ?? '',
                }
              }
            } else {
              editor.variable = {
                display: 'code',
              }
            }
          } else if (editor.type === 'plc-textual' || editor.type === 'plc-graphical') {
            if (variables.display === 'table') {
              if (editor.variable.display === 'table') {
                editor.variable = {
                  display: 'table',
                  selectedRow: variables.selectedRow?.toString() ?? editor.variable.selectedRow ?? '-1',
                  classFilter: variables.classFilter ?? editor.variable.classFilter ?? 'All',
                  description: variables.description ?? editor.variable.description ?? '',
                }
              } else {
                editor.variable = {
                  display: 'table',
                  selectedRow: variables.selectedRow?.toString() ?? '-1',
                  classFilter: variables.classFilter ?? 'All',
                  description: variables.description ?? '',
                }
              }
            } else {
              editor.variable = {
                display: 'code',
              }
            }
          }
        }),
      ),

    updateModelTasks: (tasks: { selectedRow: number; display: 'code' | 'table' }) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state
          if (editor.type === 'plc-resource') {
            if (tasks.display === 'table') {
              editor.task = {
                ...editor.task,
                display: 'table',
                selectedRow: tasks.selectedRow.toString(),
              }
            } else {
              editor.variable = {
                display: 'code',
              }
            }
          }
        }),
      ),

    updateModelInstances: (instances: { selectedRow: number; display: 'code' | 'table' }) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state
          if (editor.type === 'plc-resource') {
            if (instances.display === 'table') {
              editor.instance = {
                ...editor.instance,
                display: 'table',
                selectedRow: instances.selectedRow.toString(),
              }
            } else {
              editor.variable = {
                display: 'code',
              }
            }
          }
        }),
      ),

    setEditor: (newEditor) =>
      setState(
        produce((state: EditorState) => {
          /**
           * Update the editor state if exists at editors
           */
          const oldEditor = state.editor
          if (oldEditor.meta.name === newEditor.meta.name) return
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
      const { editor, editors } = getState()
      if (name === editor.meta.name) return editor
      return editors.find((model) => model.meta.name === name) ?? null
    },
  },
})
