import Editor from '@monaco-editor/react'
import { useRef } from 'react'
import { useStore } from 'zustand'

import { useTheme } from '@/hooks'
import pouStore from '@/stores/Pou'

// import projectStore from '@/stores/Project'
import monacoConfig from './config/config'

monacoConfig()
const TextEditor = ({ path }: { path: string }) => {
  const { theme } = useTheme()
  const { pous } = useStore(pouStore)
  // const editorRef = useRef(null)

  const pouToEditPath = pous?.[path].name ?? ''

  const editorInstanceValue = useRef<string | undefined>(
    pous?.[path].body ?? 'None in pou body',
  )

  const handleEditorValue = (val: string | undefined) => {
    editorInstanceValue.current = val
  }

  return (
    <Editor
      height="100vh"
      defaultLanguage="st"
      path={pouToEditPath}
      theme={theme?.includes('dark') ? 'vs-dark' : 'light'}
      value={editorInstanceValue.current}
      onChange={handleEditorValue}
    />
  )
}

export default TextEditor
