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
  isMonacoFocused: false,
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

    updateModelTasks: (tasks: { selectedRow?: number; display: 'code' | 'table' }) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state
          if (editor.type === 'plc-resource') {
            if (tasks.display === 'table') {
              editor.task = {
                ...editor.task,
                display: 'table',
                selectedRow: tasks.selectedRow !== undefined ? tasks.selectedRow.toString() : '-1',
              }
            } else {
              editor.task = {
                display: 'code',
              }
            }
          }
        }),
      ),

    updateModelInstances: (instances: { selectedRow?: number; display: 'code' | 'table' }) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state
          if (editor.type === 'plc-resource') {
            if (instances.display === 'table') {
              editor.instance = {
                ...editor.instance,
                display: 'table',
                selectedRow: instances.selectedRow !== undefined ? instances.selectedRow.toString() : '-1',
              }
            } else {
              editor.instance = {
                display: 'code',
              }
            }
          }
        }),
      ),

    updateModelStructure: ({ selectedRow, description }) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state
          if (editor.type === 'plc-datatype') {
            editor.structure = {
              selectedRow: selectedRow !== undefined ? selectedRow.toString() : editor.structure.selectedRow,
              description: description ? description : editor.structure.description,
            }
          }
        }),
      ),

    updateModelLadder: ({ openRung }) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state
          if (editor.type === 'plc-graphical' && editor.graphical.language === 'ld') {
            if (openRung) {
              const { rungId, open } = openRung
              const rung = editor.graphical.openedRungs.find((rung) => rung.rungId === rungId)
              if (rung) {
                editor.graphical.openedRungs = editor.graphical.openedRungs.map((rung) => {
                  if (rung.rungId === rungId) {
                    return {
                      ...rung,
                      open,
                    }
                  }
                  return rung
                })
              }
              editor.graphical.openedRungs.push({
                rungId,
                open,
              })
            }
          }
        }),
      ),
    getIsRungOpen: ({ rungId }) => {
      const { editor } = getState()
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'ld') {
        const rung = editor.graphical.openedRungs.find((rung) => {
          return rung.rungId === rungId
        })
        if (rung) return rung.open
      }
      return null
    },

    updateModelFBD: ({ hoveringElement, canEditorZoom, canEditorPan }) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state
          if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
            if (canEditorZoom !== undefined) {
              editor.graphical.canEditorZoom = canEditorZoom
            }

            if (canEditorPan !== undefined) {
              editor.graphical.canEditorPan = canEditorPan
            }

            if (hoveringElement) {
              editor.graphical.hoveringElement = {
                elementId: hoveringElement.elementId,
                hovering: hoveringElement.hovering,
              }
            }
          }
        }),
      ),

    updateEditorModel: (currentEditor: string, newEditor: string) => {
      if (currentEditor === newEditor) return
      setState(
        produce((state: EditorState) => {
          const { editor, editors } = state
          const oldEditorModel = editors.findIndex((model) => model.meta.name === currentEditor)
          if (oldEditorModel === -1) return
          Object.assign(editors[oldEditorModel], { meta: { name: newEditor } })
          Object.assign(editor, { meta: { name: newEditor } })
        }),
      )
    },

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

    saveEditorViewState: ({ prevEditorName, cursorPosition, scrollPosition, fbdPosition }) =>
      setState(
        produce((state: EditorState) => {
          const currentEditor = state.editor
          if (currentEditor.type === 'available') return

          const index = state.editors.findIndex((e) => e.meta.name === prevEditorName)
          if (index === -1) return

          state.editors[index].cursorPosition = cursorPosition
          state.editors[index].scrollPosition = scrollPosition
          if (state.editors[index].type === 'plc-graphical') {
            state.editors[index].fbdPosition = fbdPosition
          }
        }),
      ),

    getEditorFromEditors: (name) => {
      const { editor, editors } = getState()
      if (name === editor.meta.name) return editor
      return editors.find((model) => model.meta.name === name) ?? null
    },
    setMonacoFocused: (focused: boolean) => {
      setState({ isMonacoFocused: focused })
    },
  },
})
