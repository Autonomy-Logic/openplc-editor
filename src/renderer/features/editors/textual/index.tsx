import './config/index'

import { Editor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@process:renderer/store'
import _ from 'lodash'
import * as monaco from 'monaco-editor'
import { ComponentProps, useCallback, useRef } from 'react'

type IEditorProps = ComponentProps<typeof Editor>

export default function TextEditor(props: IEditorProps) {
  // const { path, defaultValue, language, theme } = props
  const updatePou = useOpenPLCStore().workspaceActions.updatePou
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const {
    path,
    language,
    value,
    workspaceState: {
      systemConfigs: { shouldUseDarkMode },
    },
  } = useOpenPLCStore()

  // console.log({ path, language, theme, value, colorScheme })
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
      const normalizedUri = editorRef.current.getModel()?.uri.path.replace('/', '')
      return normalizedUri
    }
    return null
  }, [])

  const debounce = useCallback(
    _.debounce((_editorValue: string | undefined) => {
      const fileToEdit = verifyEditor()
      if (!fileToEdit) return
      updatePou({ data: { name: fileToEdit, language: 'IL', body: _editorValue } })
    }, 750),
    [],
  )

  const handleChange = (
    value: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ev: monaco.editor.IModelContentChangedEvent,
  ) => {
    debounce(value)
  }

  console.log(typeof handleChange)

  return (
    <Editor
      onMount={handleEditorInstance}
      path={path}
      language={language}
      defaultValue={value}
      theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
      // onChange={handleChange}
      saveViewState={false}
      {...props}
    />
  )
}

// editor.IStandaloneCodeEditor
