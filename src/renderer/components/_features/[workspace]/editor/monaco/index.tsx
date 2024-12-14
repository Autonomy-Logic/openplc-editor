import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@process:renderer/store'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'

type monacoEditorProps = {
  path: string
  name: string
  language: 'il' | 'st'
}

type monacoEditorOptionsType = monaco.editor.IStandaloneEditorConstructionOptions

const MonacoEditor = (props: monacoEditorProps): ReturnType<typeof PrimitiveEditor> => {
  const { language, path, name } = props
  const editorRef = useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const monacoRef = useRef<null | typeof monaco>(null)

  const {
    // editor: { path, language, name },
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    project: {
      data: { pous },
    },
    projectActions: { updatePou },
    searchQuery,
    sensitiveCase,
    regularExpression,
  } = useOpenPLCStore()

  useEffect(() => {
    if (editorRef.current && searchQuery) {
      moveToMatch(editorRef.current, searchQuery, sensitiveCase, regularExpression)
    }
  }, [searchQuery, sensitiveCase, regularExpression])

  function handleEditorDidMount(
    editor: null | monaco.editor.IStandaloneCodeEditor,
    monacoInstance: null | typeof monaco,
  ) {
    // here is the editor instance
    // you can store it in `useRef` for further usage
    editorRef.current = editor

    // here is another way to get monaco instance
    // you can also store it in `useRef` for further usage
    monacoRef.current = monacoInstance

    if (searchQuery) {
      moveToMatch(editor, searchQuery, sensitiveCase, regularExpression)
    }
  }

  function moveToMatch(
    editor: monaco.editor.IStandaloneCodeEditor | null,
    searchQuery: string,
    sensitiveCase: boolean,
    regularExpression: boolean,
  ) {
    if (!editor || !monacoRef.current || !searchQuery) return

    const model = editor.getModel()
    if (!model) return

    const matches = model.findMatches(searchQuery, true, regularExpression, sensitiveCase, null, true)

    if (matches && matches.length > 0) {
      const firstMatchRange = matches[0].range
      editor.setSelection(firstMatchRange)
      editor.revealRangeInCenter(firstMatchRange)
    }
  }

  function handleWriteInPou(value: string | undefined) {
    if (!value) return
    updatePou({ name, content: { language, value } })
  }

  const monacoEditorUserOptions: monacoEditorOptionsType = {
    minimap: {
      enabled: false,
    },
    dropIntoEditor: {
      enabled: true,
    },
  }

  window.addEventListener('onDropIntoEditor', (event) => {
    console.log('onDropIntoEditor', event)
  })

  // console.log('Editor instance: ', editorRef.current?.getModel()?.uri.path)
  // console.log('Monaco instance: ', monacoRef.current?.editor.getEditors())
  // console.log('Pous ->', pous)

  return (
    <PrimitiveEditor
      options={monacoEditorUserOptions}
      height='100%'
      width='100%'
      path={path}
      language={language}
      defaultValue={pous.find((pou) => pou.data.name === name)?.data.body.value as string}
      onMount={handleEditorDidMount}
      onChange={handleWriteInPou}
      theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
    />
  )
}
export { MonacoEditor }
