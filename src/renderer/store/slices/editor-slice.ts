import { produce } from 'immer'
import { StateCreator } from 'zustand'

type IEditorProps = {
  name: string
  path: string
  language: string
}
type IEditorState = {
  editor: IEditorProps
}

type IEditorActions = {
  setEditor: (editorToBeCreated: IEditorProps) => void
  clearEditor: () => void
}

export type IEditorSlice = IEditorState & {
  editorActions: IEditorActions
}

export const createEditorSlice: StateCreator<IEditorSlice, [], [], IEditorSlice> = (setState) => ({
  editor: {
    name: '',
    path: '',
    language: '',
  },
  editorActions: {
    setEditor: (editorToBeCreated: IEditorProps): void =>
      setState(
        produce((slice: IEditorSlice) => {
          slice.editor = editorToBeCreated
        }),
      ),
    clearEditor: (): void =>
      setState(
        produce((slice: IEditorSlice) => {
          slice.editor = { name: '', path: '', language: '' }
        }),
      ),
  },
})
