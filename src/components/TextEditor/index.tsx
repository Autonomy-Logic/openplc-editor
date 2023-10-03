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
  useEffect(() => {
    const pro = () => {
      console.log('In text -> ', projectXmlAsObj)
    }
    pro()
  }, [projectXmlAsObj])

  return (
    <>
      <Editor
        height="100vh"
        language="st" // language={currentPou.language?.toLowerCase()}
        // path={currentPou.name}
        // defaultValue={currentPou.body}
        // onChange={handleEditorValue}
        theme={theme?.includes('dark') ? 'vs-dark' : 'light'}
      />
    </>
  )
}

export default TextEditor
