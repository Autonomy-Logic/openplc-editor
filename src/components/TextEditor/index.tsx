import Editor from '@monaco-editor/react'
import { editor } from 'monaco-editor'
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useStore } from 'zustand'

import { useTabs, useTheme } from '@/hooks'
import pouStore from '@/stores/Pou'

// import projectStore from '@/stores/Project'
import monacoConfig from './config/config'

interface Pou {
  body: string
  id: number
  language: string
  name: string
  type: string
}

interface TabsProps {
  /**
   * The ID of the tab. Can be a number or a string.
   */
  id?: number | string
  /**
   * The title of the tab.
   */
  title: string

  current?: boolean
}

monacoConfig()
const TextEditor = () => {
  let valuesForEditor
  const { theme } = useTheme()
  const { pous, writeInPou } = useStore(pouStore)
  const { tabs } = useTabs()
  const [editor, setEditor] = useState<Pou>({
    body: '',
    id: 0,
    language: '',
    name: '',
    type: '',
  })

  const [pouInCurrentTab, setPouInCurrentTab] = useState<string | number>('')
  const pousOnEditStage = useRef(Object.values(pous))
  console.log('Variable -> ', pousOnEditStage.current)

  const getPousToEditStage = useCallback(
    () => (pousOnEditStage.current = Object.values(pous)),
    [pous],
  )

  useEffect(() => {
    const getEditorValues = () => {
      for (const value of tabs.values()) {
        if (value.current) {
          setPouInCurrentTab(value.id)
        }
      }
    }
    getEditorValues()
    getPousToEditStage()
  }, [getPousToEditStage, tabs])

  const handleEditorDidMount = () => {
    valuesForEditor = editor
  }

  const handleEditorValue = (val: string | undefined) => {
    // writeInPou({ pouName: editor.name, body: val as string })
    console.log('Here')
  }

  return (
    <>
      <Editor
        height="100vh"
        defaultLanguage="st"
        path={valuesForEditor?.name}
        value={valuesForEditor?.body}
        theme={theme?.includes('dark') ? 'vs-dark' : 'light'}
        onChange={handleEditorValue}
        onMount={handleEditorDidMount}
      />
    </>
  )
}

export default TextEditor
