import Editor from '@monaco-editor/react'
import { FC, useRef } from 'react'
import { useStore } from 'zustand'

import projectStore from '@/stores/Project'

import monacoConfig from './config/config'

monacoConfig()
const TextEditor: FC = () => {
  const { currentProject } = useStore(projectStore)
  // const editorRef = useRef(null)
  const editorVal = useRef<string | undefined>(
    (currentProject.xmlSerializedAsObject as unknown as string) ?? '',
  )

  // function handleEditorInstance(editor, monaco) {
  //   editorRef.current = monaco
  //   console.log(editorRef.current)
  // }

  const handleEditorValue = (val: string | undefined) => {
    console.log(val)
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
