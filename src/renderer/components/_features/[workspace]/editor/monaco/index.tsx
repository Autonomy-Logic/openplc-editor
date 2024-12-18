import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { Modal, ModalContent, ModalTitle } from '@process:renderer/components/_molecules/modal'
import { useOpenPLCStore } from '@process:renderer/store'
import type { LibraryState } from '@root/renderer/store/slices'
import * as monaco from 'monaco-editor'
import { useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { toast } from '../../../[app]/toast/use-toast'
import { parsePouToStText } from './drag-and-drop/st'

type monacoEditorProps = {
  path: string
  name: string
  language: 'il' | 'st'
}

type _qualquerCoisa = {
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
  } = useOpenPLCStore()

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [contentToDrop, setContentToDrop] = useState<_qualquerCoisa>()
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

    const pouPath = ev.dataTransfer.getData('application/library')

    const [scope, libraryName, pouName] = pouPath.split('/')

    const libraryScope = scope as 'system' | 'user'
    const libraries = sliceLibraries[libraryScope] as LibraryState['libraries']['system']

    const libraryToUse = libraries.find((library) => library.name === libraryName)

    const pouToAppend = libraryToUse?.pous?.find((pou) => pou.name === pouName)
    setContentToDrop(pouToAppend)

    const editorModel = editorRef.current?.getModel()

    const draftModelData = editorModel?.getValue()
    if (pouToAppend?.type === 'function') {
      const newModelData = draftModelData?.concat(parsePouToStText(pouToAppend as _qualquerCoisa))
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

    const existingNames = pous.flatMap((pou) => pou.data.variables.map((variable) => variable.name))

    const uniqueName = checkIfVariableExists(existingNames, newName)

    const renamedContent = { ...contentToDrop, name: uniqueName }

    console.log('Novo conteúdo renomeado:', renamedContent)

    const editorModel = editorRef.current.getModel()
    const contentToInsert = parsePouToStText(renamedContent)

    if (editorModel) {
      const draftModelData = editorModel.getValue()
      const newModelData = draftModelData ? `${draftModelData}\n${contentToInsert}` : contentToInsert

      editorModel.setValue(newModelData)
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
    console.log('Resposta: ', res)
    if (!res.ok) {
      toast({
        title: res.title,
        description: res.message,
        variant: 'fail',
      })
      return
    }
    console.log('pous: ', pous)
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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
