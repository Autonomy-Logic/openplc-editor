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

    updateModelVariables: (variables) => {
      setState(
        produce((state: EditorState) => {
          const { editor } = state

          if (editor.type === 'plc-resource') {
            if (variables.display === 'table') {
              const prevSelectedRow = editor.variable.display === 'table' ? editor.variable.selectedRow : '-1'
              const prevDescription = editor.variable.display === 'table' ? editor.variable.description : ''
              editor.variable = {
                display: 'table',
                selectedRow: variables.selectedRow?.toString() ?? prevSelectedRow,
                description: variables.description ?? prevDescription,
              }
            } else {
              const existingCode = editor.variable.display === 'code' ? editor.variable.code : undefined
              editor.variable = {
                display: 'code',
                code: variables.code !== undefined ? variables.code : existingCode,
              }
            }
          } else if (editor.type === 'plc-textual' || editor.type === 'plc-graphical') {
            if (variables.display === 'table') {
              const prevSelectedRow = editor.variable.display === 'table' ? editor.variable.selectedRow : '-1'
              const prevClassFilter = editor.variable.display === 'table' ? editor.variable.classFilter : 'All'
              const prevDescription = editor.variable.display === 'table' ? editor.variable.description : ''
              editor.variable = {
                display: 'table',
                selectedRow: variables.selectedRow?.toString() ?? prevSelectedRow,
                classFilter: variables.classFilter ?? prevClassFilter,
                description: variables.description ?? prevDescription,
              }
            } else {
              const existingCode = editor.variable.display === 'code' ? editor.variable.code : undefined
              editor.variable = {
                display: 'code',
                code: variables.code !== undefined ? variables.code : existingCode,
              }
            }
          }
        }),
      )
    },

    updateModelVariablesForName: (name, variables) =>
      setState(
        produce((state: EditorState) => {
          const targetEditor =
            state.editor.meta.name === name ? state.editor : state.editors.find((e) => e.meta.name === name)

          if (!targetEditor) return

          if (targetEditor.type === 'plc-resource') {
            if (variables.display === 'table') {
              const prevSelectedRow =
                targetEditor.variable.display === 'table' ? targetEditor.variable.selectedRow : '-1'
              const prevDescription = targetEditor.variable.display === 'table' ? targetEditor.variable.description : ''
              targetEditor.variable = {
                display: 'table',
                selectedRow: variables.selectedRow?.toString() ?? prevSelectedRow,
                description: variables.description ?? prevDescription,
              }
            } else {
              const existingCode = targetEditor.variable.display === 'code' ? targetEditor.variable.code : undefined
              targetEditor.variable = {
                display: 'code',
                code: variables.code !== undefined ? variables.code : existingCode,
              }
            }
          } else if (targetEditor.type === 'plc-textual' || targetEditor.type === 'plc-graphical') {
            if (variables.display === 'table') {
              const prevSelectedRow =
                targetEditor.variable.display === 'table' ? targetEditor.variable.selectedRow : '-1'
              const prevClassFilter =
                targetEditor.variable.display === 'table' ? targetEditor.variable.classFilter : 'All'
              const prevDescription = targetEditor.variable.display === 'table' ? targetEditor.variable.description : ''
              targetEditor.variable = {
                display: 'table',
                selectedRow: variables.selectedRow?.toString() ?? prevSelectedRow,
                classFilter: variables.classFilter ?? prevClassFilter,
                description: variables.description ?? prevDescription,
              }
            } else {
              const existingCode = targetEditor.variable.display === 'code' ? targetEditor.variable.code : undefined
              targetEditor.variable = {
                display: 'code',
                code: variables.code !== undefined ? variables.code : existingCode,
              }
            }
          }
        }),
      ),

    updateModelTasks: (tasks) =>
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
              editor.task = { display: 'code' }
            }
          }
        }),
      ),

    updateModelInstances: (instances) =>
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
              editor.instance = { display: 'code' }
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
              const rung = editor.graphical.openedRungs.find((r) => r.rungId === rungId)
              if (rung) {
                editor.graphical.openedRungs = editor.graphical.openedRungs.map((r) =>
                  r.rungId === rungId ? { ...r, open } : r,
                )
              } else {
                editor.graphical.openedRungs.push({ rungId, open })
              }
            }
          }
        }),
      ),

    getIsRungOpen: ({ rungId }) => {
      const { editor } = getState()
      if (editor.type === 'plc-graphical' && editor.graphical.language === 'ld') {
        const rung = editor.graphical.openedRungs.find((r) => r.rungId === rungId)
        if (rung) return rung.open
      }
      return true
    },

    updateModelFBD: ({ hoveringElement, canEditorZoom, canEditorPan }) =>
      setState(
        produce((state: EditorState) => {
          const { editor } = state
          if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
            if (canEditorZoom !== undefined) editor.graphical.canEditorZoom = canEditorZoom
            if (canEditorPan !== undefined) editor.graphical.canEditorPan = canEditorPan
            if (hoveringElement) {
              editor.graphical.hoveringElement = {
                elementId: hoveringElement.elementId,
                hovering: hoveringElement.hovering,
              }
            }
          }
        }),
      ),

    updateEditorModel: (currentEditor, newEditor) => {
      if (currentEditor === newEditor) return
      setState(
        produce((state: EditorState) => {
          const { editor, editors } = state
          const oldEditorModel = editors.findIndex((model) => model.meta.name === currentEditor)
          if (oldEditorModel === -1) return
          Object.assign(editors[oldEditorModel], { meta: { ...editors[oldEditorModel].meta, name: newEditor } })
          Object.assign(editor, { meta: { ...editor.meta, name: newEditor } })
        }),
      )
    },

    updateEditorName: (oldName, newName) => {
      if (oldName === newName) return
      setState(
        produce((state: EditorState) => {
          const { editor, editors } = state
          const editorIndex = editors.findIndex((model) => model.meta.name === oldName)
          if (editorIndex !== -1) {
            Object.assign(editors[editorIndex], { meta: { ...editors[editorIndex].meta, name: newName } })
          }
          if (editor.meta.name === oldName) {
            Object.assign(editor, { meta: { ...editor.meta, name: newName } })
          }
        }),
      )
    },

    setEditor: (newEditor) =>
      setState(
        produce((state: EditorState) => {
          const oldEditor = state.editor

          // Snapshot the old active editor's latest in-memory state
          // back into `editors[]` — but only when it's still there.
          // `forceCloseFile` removes the active editor's model from
          // `editors[]` BEFORE calling setEditor with the next tab;
          // re-adding it on the `else` branch would resurrect a
          // freshly-closed tab.  This way, the snapshot is a no-op
          // for tabs that have just been removed.
          if (oldEditor.type !== 'available') {
            const oldIdx = state.editors.findIndex((m) => m.meta.name === oldEditor.meta.name)
            if (oldIdx !== -1) {
              state.editors[oldIdx] = oldEditor
            }
          }

          // Idempotently ensure the new editor is registered in
          // `editors[]`.  Multi-mount consumers iterate `editors[]`
          // and assume every open tab has a corresponding entry —
          // missing it would mean the new tab's editor never renders.
          const newIdx = state.editors.findIndex((m) => m.meta.name === newEditor.meta.name)
          if (newIdx === -1) {
            state.editors.push(newEditor)
          }

          if (oldEditor.meta.name === newEditor.meta.name) return
          state.editor = newEditor
        }),
      ),

    clearEditor: () =>
      setState(
        produce((state: EditorState) => {
          state.editors = []
          state.editor = { type: 'available', meta: { name: 'available' } }
        }),
      ),

    setEditorCursor: (name, cursorPosition) =>
      setState(
        produce((state: EditorState) => {
          // Update the model in the editors array so a future tab
          // switch / re-mount picks up the new position.
          const index = state.editors.findIndex((e) => e.meta.name === name)
          if (index !== -1) {
            state.editors[index].cursorPosition = cursorPosition
          }
          // Update the active editor too if it's the one we're
          // navigating into — this is what triggers the Monaco
          // reactive useEffect that selects the line.  Immer treats
          // `state.editor` and `state.editors[index]` as separate
          // drafts even when the underlying object started identical,
          // so writing to both is required.
          if (state.editor.meta.name === name && state.editor.type !== 'available') {
            state.editor.cursorPosition = cursorPosition
          }
        }),
      ),

    getEditorFromEditors: (name) => {
      const { editor, editors } = getState()
      if (name === editor.meta.name) return editor
      return editors.find((model) => model.meta.name === name) ?? null
    },

    setMonacoFocused: (focused) => {
      setState({ isMonacoFocused: focused })
    },
  },
})
