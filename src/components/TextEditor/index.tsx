import Editor from '@monaco-editor/react'
import { useCallback, useEffect, useState } from 'react'
import { useStore } from 'zustand'

import { useTabs, useTheme } from '@/hooks'
import pouStore, { IPouProps } from '@/stores/Pou'

import monacoConfig from './config/config'

monacoConfig()
const TextEditor = () => {
  const { theme } = useTheme()
  const { pous } = useStore(pouStore)
  const { tabs } = useTabs()
  const tabIterator = tabs[Symbol.iterator]()
  const [currentPou, setCurrentPou] = useState<IPouProps>({
    id: 0,
    name: '',
    type: '',
    body: '',
    language: '',
  })
  /**
   * @description Function to handle values and supply the editor instance with the basic props.
   * @returns void
   */
  const setEditorValues = useCallback(() => {
    for (const value of tabIterator) {
      if (value.current) {
        setCurrentPou(pous[value.title])
      }
    }
  }, [pous, tabIterator])

  const handleEditorValue = useCallback(
    (val: string | undefined) => {
      const data = { pouName: currentPou.name, body: val }
      console.log(data)
    },
    [currentPou.name],
  )
  useEffect(() => {
    setEditorValues()
  }, [setEditorValues])
  return (
    <>
      <Editor
        height="100vh"
        defaultLanguage={currentPou.language}
        path={currentPou.name}
        defaultValue={currentPou.body}
        onChange={handleEditorValue}
        theme={theme?.includes('dark') ? 'vs-dark' : 'light'}
      />
    </>
  )
}

export default TextEditor
