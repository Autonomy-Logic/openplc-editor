import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { Modal, ModalContent, ModalTitle } from '@process:renderer/components/_molecules/modal'
import { useOpenPLCStore } from '@process:renderer/store'
import * as monaco from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { toast } from '../../../[app]/toast/use-toast'
import { parsePouToStText } from './drag-and-drop/st'

type monacoEditorProps = {
  path: string
  name: string
  language: 'il' | 'st'
}

type PouToText = {
  name: string
  language: string
  type: string
  body: string
  documentation: string
  variables: {
    name: string
    class: string
    type: { definition: string; value: string }
  }[]
}
type monacoEditorOptionsType = monaco.editor.IStandaloneEditorConstructionOptions

const MonacoEditor = (props: monacoEditorProps): ReturnType<typeof PrimitiveEditor> => {
  const { language, path, name } = props
  const editorRef = useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const monacoRef = useRef<null | typeof monaco>(null)

  const {
    editor,
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    project: {
      data: { pous },
    },
    libraries: sliceLibraries,
    projectActions: { updatePou, createVariable },
    searchQuery,
    sensitiveCase,
    regularExpression,
  } = useOpenPLCStore()

  useEffect(() => {
    if (editorRef.current && searchQuery) {
      moveToMatch(editorRef.current, searchQuery, sensitiveCase, regularExpression)
    }
  }, [searchQuery, sensitiveCase, regularExpression])

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [contentToDrop, setContentToDrop] = useState<PouToText>()
  const [newName, setNewName] = useState<string>('')

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

  const handleDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    ev.stopPropagation()
    let pouToAppend
    const pouPath = ev.dataTransfer.getData('application/library')

    const [scope, libraryName, pouName] = pouPath.split('/')

    const libraryScope = scope as 'system' | 'user'
    if (libraryScope === 'system') {
      const libraries = sliceLibraries.system
      const libraryToUse = libraries.find((library) => library.name === libraryName)
      pouToAppend = libraryToUse?.pous.find((pou) => pou.name === pouName)
    } else {
      const libraries = sliceLibraries.user
      const libraryToUse = libraries.find((library) => library.name === libraryName)
      pouToAppend = libraryToUse
    }
    setContentToDrop(pouToAppend as PouToText)

    const editorModel = editorRef.current?.getModel()

    const draftModelData = editorModel?.getValue()
    if (pouToAppend?.type === 'function') {
      const newModelData = draftModelData?.concat(parsePouToStText(pouToAppend as PouToText))
      editorModel?.setValue(newModelData as string)
      return
    } else {
      setIsOpen(true)
    }
  }

  function checkIfVariableExists(existingNames: string[], baseName: string): string {
    let newName = baseName
    let index = 1

    while (existingNames.includes(newName)) {
      newName = `${baseName}_${index}`
      index++
    }

    return newName
  }

  const handleRenamePou = () => {
    if (!contentToDrop || !editorRef.current) return

    const currentEditor = pous.find((pou) => pou.data.name === editor.meta.name)
    if (!currentEditor) return

    const existingNames = currentEditor.data.variables.map((variable) => variable.name)
    const uniqueName = checkIfVariableExists(existingNames, newName)

    const renamedContent = { ...contentToDrop, name: uniqueName }

    const editorModel = editorRef.current.getModel()
    const contentToInsert = parsePouToStText(renamedContent)

    if (editorModel) {
      const cursorPosition = editorRef.current.getPosition()
      if (!cursorPosition) return

      editorModel.pushEditOperations(
        [],
        [
          {
            range: new monaco.Range(
              cursorPosition.lineNumber,
              cursorPosition.column,
              cursorPosition.lineNumber,
              cursorPosition.column,
            ),
            text: contentToInsert,
            forceMoveMarkers: true,
          },
        ],
        () => null,
      )
    }

    setIsOpen(false)
    setNewName('')

    const res = createVariable({
      data: {
        id: uuidv4(),
        name: uniqueName,
        type: {
          definition: 'derived',
          value: contentToDrop.name,
        },
        class: 'local',
        location: '',
        documentation: '',
        debug: false,
      },
      scope: 'local',
      associatedPou: editor.meta.name,
    })

    if (!res.ok) {
      toast({
        title: res.title,
        description: res.message,
        variant: 'fail',
      })
      return
    }
  }

  const handleCancelRenamePou = () => {
    setIsOpen(false)
    setNewName('')
  }

  return (
    <>
      <div id='editor drop handler' className='h-full w-full' onDrop={handleDrop}>
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
      </div>
      <Modal open={isOpen} onOpenChange={setIsOpen}>
        <ModalContent className='flex h-56 w-96 select-none flex-col justify-between gap-2 rounded-lg p-8'>
          <ModalTitle className='text-sm font-medium text-neutral-950 dark:text-white'>
            Please enter a name for the block
          </ModalTitle>
          <label htmlFor='Block name' className='text-xs text-neutral-600 dark:text-neutral-50'>
            Block name
          </label>
          <input
            id='Block name'
            className='mb-1 mt-[6px] h-[30px] w-full rounded-md border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className='flex h-8 w-full justify-evenly gap-7'>
            <button
              onClick={handleCancelRenamePou}
              className='h-full w-[236px] rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
            >
              Cancel
            </button>
            <button
              type='button'
              className={`h-8 w-52 rounded-lg bg-brand text-white ${!newName || newName === '' ? 'cursor-not-allowed opacity-50' : ''}`}
              onClick={handleRenamePou}
              disabled={!newName || newName === ''}
            >
              Ok
            </button>
          </div>
        </ModalContent>
      </Modal>
    </>
  )
}
export { MonacoEditor }
