import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@process:renderer/store'
import * as monaco from 'monaco-editor'
import { useRef } from 'react'

const MonacoEditor = (): ReturnType<typeof PrimitiveEditor> => {
  const editorRef = useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const monacoRef = useRef<null | typeof monaco>(null)
  const {
    editor: { path, language, name },
    systemConfigs: { shouldUseDarkMode },
    projectData: { pous },
    workspaceActions: { updatePou },
  } = useOpenPLCStore()

  function handleEditorDidMount(
    editor: null | monaco.editor.IStandaloneCodeEditor,
    monacoInstance: null | typeof monaco,
  ) {
    // here is the editor instance
    // you can store it in `useRef` for further usage
    editorRef.current = editor

    // here is another way to get monaco instance
    // you can also store it in `useRef` for further usage
    monacoRef.current = monacoInstance
  }

  function handleWriteInPou(value: string | undefined) {
    if (!value) return
    updatePou({ name, content: value })
  }

  // console.log('Editor instance: ', editorRef.current?.getModel()?.uri.path)
  // console.log('Monaco instance: ', monacoRef.current?.editor.getEditors())
  // console.log('Pous ->', pous)

  return (
    <PrimitiveEditor
      height='100%'
      width='100%'
      path={path}
      language={language}
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      defaultValue={pous.find((pou) => pou.data.name === name)?.data.body}
      onMount={handleEditorDidMount}
      onChange={handleWriteInPou}
      theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
    />
  )
}
export { MonacoEditor }
