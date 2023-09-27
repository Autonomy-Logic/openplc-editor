import Editor from '@monaco-editor/react'
import { useCallback, useEffect, useState } from 'react'
import { useStore } from 'zustand'

import { useTabs, useTheme } from '@/hooks'
import { IPouProps } from '@/stores/Pou'
import projectStore from '@/stores/Project'

import monacoConfig from './config/config'

// ! Breaking full, need a fixes...

monacoConfig()
const TextEditor = () => {
  const { projectXmlAsObj } = useStore(projectStore)
  const { theme } = useTheme()
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
    if (projectXmlAsObj?.project.types.pous) {
      for (const value of tabIterator) {
        if (value.current) {
          setCurrentPou(projectXmlAsObj?.project.types.pous[value.title])
          break
        }
      }
    }
    setCurrentPou({
      id: 0,
      name: 'string',
      type: 'string',
      body: 'string',
      language: 'ST',
    })
  }, [projectXmlAsObj, tabIterator])

  const handleEditorValue = useCallback(
    (val: string | undefined) => {
      const data = { pouName: currentPou.name, body: val }
      console.log('Aqui ->', data)
    },
    [currentPou?.name],
  )
  useEffect(() => {
    if (projectXmlAsObj) {
      setEditorValues()
    }
  }, [projectXmlAsObj, setEditorValues])
  return (
    <>
      <Editor
        height="100vh"
        language={currentPou.language?.toLowerCase()}
        path={currentPou.name}
        defaultValue={currentPou.body}
        onChange={handleEditorValue}
        theme={theme?.includes('dark') ? 'vs-dark' : 'light'}
      />
    </>
  )
}

export default TextEditor
