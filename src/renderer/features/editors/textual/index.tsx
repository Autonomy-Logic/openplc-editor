import './config/index'

import * as monaco from 'monaco-editor'
import { Editor } from '@monaco-editor/react'
import { IpcRendererEvent } from 'electron/renderer'
import _ from 'lodash'
import { ComponentProps, useCallback, useEffect, useRef, useState } from 'react'

import { useOpenPLCStore } from '~renderer/store'

type IEditorProps = ComponentProps<typeof Editor>

export default function TextEditor(props: IEditorProps) {
	const projectPath = useOpenPLCStore.usePath()
	const projectData = useOpenPLCStore.useData()
	const updatePou = useOpenPLCStore.useUpdatePou()
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
	const [isDark, setIsDark] = useState(true)
	const themePreference = useOpenPLCStore.useColorScheme()

	/**
	 *  here is the editor instance, you can store it in `useRef` for further usage
	 */
	function handleEditorInstance(editor: monaco.editor.IStandaloneCodeEditor) {
		editorRef.current = editor
	}

	/**
	 * Verifies if the editor instance is valid
	 */
	const verifyEditor = useCallback(() => {
		if (editorRef.current) {
			const normalizedUri = editorRef.current
				.getModel()
				?.uri.path.replace('/', '')
			return normalizedUri
		}
		return null
	}, [])

	const debounce = useCallback(
		_.debounce((_editorValue) => {
			const fileToEdit = verifyEditor()
			if (!fileToEdit) return
			updatePou({ '@name': fileToEdit, body: _editorValue })
		}, 750),
		[]
	)

	const handleChange = (
		value: string | undefined,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		_ev: monaco.editor.IModelContentChangedEvent
	) => {
		debounce(value)
	}

	const setEditorPath = useCallback(() => {
		return ''
	}, [])

	const setPouInStage = useCallback(() => {
		const res = projectData
		return res
	}, [projectData])

	return (
		<Editor
			path={setEditorPath()}
			defaultValue={setPouInStage()}
			onMount={handleEditorInstance}
			onChange={handleChange}
			theme={themePreference === 'dark' ? 'openplc-dark' : 'openplc-light'}
			{...props}
		/>
	)
}

// editor.IStandaloneCodeEditor