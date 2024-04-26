import { produce } from 'immer'
import { StateCreator } from 'zustand'

type IEditorState = {
  path: string
  language: string
  value: string
}

type IEditorActions = {
  setEditor: (editor: IEditorState) => void
  updateEditor: (editor: Partial<IEditorState>) => void
  clearEditor: () => void
}

export type IEditorSlice = {
  editorState: IEditorState
  editorActions: IEditorActions
}

export const createEditorSlice: StateCreator<IEditorSlice, [], [], IEditorSlice> = (setState) => ({
  editorState: {
    path: '',
    language: '',
    value: '',
  },
  editorActions: {
    setEditor: (editor: IEditorState): void => setState(produce((slice: IEditorSlice) => (slice.editorState = editor))),
    updateEditor: (editor: Partial<IEditorState>): void =>
      setState(
        produce((slice: IEditorSlice) => {
          Object.assign(slice.editorState, editor)
        }),
      ),
    clearEditor: (): void =>
      setState(
        produce((slice: IEditorSlice) => {
          slice.editorState.path = ''
          slice.editorState.language = ''
          slice.editorState.value = ''
        }),
      ),
  },
})
