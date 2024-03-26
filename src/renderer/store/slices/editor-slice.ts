import { produce } from 'immer'
import { StateCreator } from 'zustand'

type IEditorState = {
	path: string
	language: string
	theme: string
	value: string
}

type IEditorActions = {
	setEditor: (editor: IEditorState) => void
	updateEditor: (editor: Partial<IEditorState>) => void
	clearEditor: () => void
}

export type IEditorSlice = IEditorState & IEditorActions

export const createEditorSlice: StateCreator<
	IEditorSlice,
	[],
	[],
	IEditorSlice
> = (setState) => ({
	path: '',
	language: '',
	theme: '',
	value: '',
	setEditor: (editor: IEditorState): void =>
		setState(
			produce((state: IEditorState) => {
				state.path = editor.path
				state.language = editor.language
				state.theme = editor.theme
				state.value = editor.value
			})
		),
	updateEditor: (editor: Partial<IEditorState>): void =>
		setState(
			produce((state: IEditorState) => {
				if (editor.path) state.path = editor.path
				if (editor.language) state.language = editor.language
				if (editor.theme) state.theme = editor.theme
				if (editor.value) state.value = editor.value
			})
		),
	clearEditor: (): void =>
		setState(
			produce((state: IEditorState) => {
				state.path = ''
				state.language = ''
				state.theme = ''
				state.value = ''
			})
		),
})
