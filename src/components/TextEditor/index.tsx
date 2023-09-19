import Editor from '@monaco-editor/react'
import { FC, useRef } from 'react'
import { useStore } from 'zustand'

import { useTheme } from '@/hooks'
import pouStore from '@/stores/Pou'
import projectStore from '@/stores/Project'

import monacoConfig from './config/config'

monacoConfig()
const TextEditor: FC = () => {
  const { theme } = useTheme()
  const { programOrganizationUnity, writeInPou } = useStore(pouStore)
  // const editorRef = useRef(null)
  const editorVal = useRef<string | undefined>(
    programOrganizationUnity?.body ?? '',
  )

  const handleEditorValue = (val: string | undefined) => {
    writeInPou(val)
  }
  console.log(programOrganizationUnity)

  return (
    <Editor
      height="100vh"
      defaultLanguage="st"
      theme={theme == 'dark' ? 'vs-dark' : 'light'}
      value={editorVal.current}
      onChange={handleEditorValue}
    />
  )
}

export default TextEditor
