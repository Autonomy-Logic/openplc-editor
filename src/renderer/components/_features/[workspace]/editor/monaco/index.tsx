import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@process:renderer/store'
import * as monaco from 'monaco-editor'
import { useRef } from 'react'

const MonacoEditor = (): ReturnType<typeof PrimitiveEditor> => {
  const editorRef = useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const monacoRef = useRef<null | typeof monaco>(null)

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

  console.log(editorRef.current?.getModel()?.getValue())
  // console.log(monacoRef.current?.editor.getModels())

  const {
    editorState: {
      editor: { path, language, name },
    },
    workspaceState: {
      projectData: { pous },
    },
  } = useOpenPLCStore()

  return (
    <PrimitiveEditor
      height='100%'
      width='100%'
      path={path}
      language={language}
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      defaultValue={pous.find((pou) => pou.data.name === name)?.data.body}
      onMount={handleEditorDidMount}
      onChange={(v) => console.log(v)}
      theme='openplc-dark'
    />
  )
}
export { MonacoEditor }
