import { produce } from 'immer'
import { StateCreator } from 'zustand'

type IEditorProps = {
  path: string
  language: string
  value: string
  isEditorOpen: boolean
}
type IEditorState = {
  editors: IEditorProps[]
}

type IEditorActions = {
  setEditor: (editorToBeCreated: IEditorProps) => void
  updateEditor: (dataToUpdateEditor: Partial<IEditorState>) => void
  clearEditor: () => void
}

export type IEditorSlice = {
  editorState: IEditorState
  editorActions: IEditorActions
}

export const createEditorSlice: StateCreator<IEditorSlice, [], [], IEditorSlice> = (setState) => ({
  editorState: {
    editors: [],
  },
  editorActions: {
    setEditor: (editorToBeCreated: IEditorProps): void =>
      setState(
        produce(({ editorState }: IEditorSlice) => {
          editorState.editors.push(editorToBeCreated)
        }),
      ),
    updateEditor: (dataToUpdateEditor: Partial<IEditorProps>): void =>
      setState(
        produce((slice: IEditorSlice) => {
          const { editors } = slice.editorState
          const editorExists = editors.find((editor) => editor.path === dataToUpdateEditor.path)
          if (editorExists) {
            Object.assign(editors[editors.indexOf(editorExists)], dataToUpdateEditor)
          }
        }),
      ),
    clearEditor: (): void => setState(produce((slice: IEditorSlice) => (slice.editorState.editors = []))),
  },
})
