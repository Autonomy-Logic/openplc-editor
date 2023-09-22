import Editor from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'

import { useTheme } from '@/hooks'
import pouStore from '@/stores/Pou'

// import projectStore from '@/stores/Project'
import monacoConfig from './config/config'

monacoConfig()
const TextEditor = () => {
  const { theme } = useTheme()
  const { pous } = useStore(pouStore)
  const pousOnStage = useRef([])

  useEffect(() => {
    function setPousToEdit() {
      pousOnStage.current.push(pous as unknown as never)
      console.log(pousOnStage.current)
    }
    setPousToEdit()
  }, [pous])

  const [pouEditing, setPouEditing] = useState('')

  const file = pous[pouEditing]

  const pouBody = useRef<string | undefined>(file ? file.body : undefined)

  const handleEditorValue = (val: string | undefined) => {
    pouBody.current = val
  }

  return (
    <>
      <Editor
        height="100vh"
        defaultLanguage="st"
        path={file.name}
        theme={theme?.includes('dark') ? 'vs-dark' : 'light'}
        value={pouBody.current}
        onChange={handleEditorValue}
      />
    </>
  )
}

export default TextEditor
