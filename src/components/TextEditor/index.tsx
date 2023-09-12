import Editor from '@monaco-editor/react'
import { FC, useRef } from 'react'
import { useStore } from 'zustand'

import OpenPlcEditorStore from '@/store'

import monacoConfig from './config/config'

monacoConfig()
const TextEditor: FC = () => {
  const StoreTo = useStore(OpenPlcEditorStore)
  // const editorRef = useRef(null)
  const editorVal = useRef<string | undefined>(StoreTo.pouData.body ?? '')

  // function handleEditorInstance(editor, monaco) {
  //   editorRef.current = monaco
  //   console.log(editorRef.current)
  // }

  const handleEditorValue = (val: string | undefined) => {
    StoreTo.updateBody(val)
  }

  return (
    <Editor
      height="100vh"
      defaultLanguage="st"
      theme="vs-dark"
      value={editorVal.current}
      onChange={handleEditorValue}
    />
  )
}

export default TextEditor
