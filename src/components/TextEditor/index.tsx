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

  const pouInCurrentTab = useRef<TabsProps>()

  const getEditorValues = useCallback(() => {
    for (const value of tabs.values()) {
      if (value.current) {
        pouInCurrentTab.current = value
      }
    }
    const PouQuery = pouInCurrentTab.current?.id ?? ''
    setEditor(pous[PouQuery] as Pou)
  }, [pous, tabs])

  useEffect(() => {
    getEditorValues()
  }, [getEditorValues])

  const handleEditorValue = useCallback(
    (val: string | undefined) => {
      writeInPou({ pouName: editor.name, body: val as string })
    },
    [editor.name, writeInPou],
  )

  console.log('Pous', pous)

  return (
    <>
      <Editor
        height="100vh"
        defaultLanguage="st"
        defaultValue={editor.body}
        path={editor.name}
        theme={theme?.includes('dark') ? 'vs-dark' : 'light'}
        onChange={() => handleEditorValue}
      />
    </>
  )
}

export default TextEditor
