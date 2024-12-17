import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import {Modal, ModalContent, ModalTitle} from '@process:renderer/components/_molecules/modal'
import { useOpenPLCStore } from '@process:renderer/store'
import type { LibraryState } from '@root/renderer/store/slices'
import * as monaco from 'monaco-editor'
import { useRef, useState } from 'react'

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
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    project: {
      data: { pous },
    },
    libraries: sliceLibraries,
    projectActions: { updatePou },
  } = useOpenPLCStore()

  const [isOpen, setIsOpen] = useState<boolean>(false)

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

    // Caution!
    // Todo: Add validation for user defined libraries
    const libraries = sliceLibraries[libraryScope] as LibraryState['libraries']['system']

    const libraryToUse = libraries.find((library) => library.name === libraryName)

    const pouToAppend = libraryToUse?.pous?.find((pou) => pou.name === pouName)

    const editorModel = editorRef.current?.getModel()

    const draftModelData = editorModel?.getValue()

    /**
     * TODO: Adicionar o conteudo na posicão do cursor
     */
    if(pouToAppend?.type === 'function'){
      const newModelData = draftModelData?.concat(parsePouToStText(pouToAppend as _qualquerCoisa))
      editorModel?.setValue(newModelData as string)
      return
    } else {
      /**
       * TODO:
       * - Criar variavel para ser associada com o pou do tipo function block
       */
      setIsOpen(true)
    }
  }

  // console.log('Editor instance: ', editorRef.current?.getModel()?.uri.path)
  // console.log('Monaco instance: ', monacoRef.current?.editor.getEditors())

  return (
    <>

    <div id='editor drop handler' className='w-full h-full' onDrop={handleDrop}>
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
        <ModalContent className='flex max-h-56 w-fit select-none flex-col justify-between gap-2 rounded-lg p-8'>
          <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Set a name</ModalTitle>
          <input className='text-sm text-neutral-600 dark:text-neutral-50' />
          <div className='flex h-8 w-full justify-evenly gap-7'>
            <button className='h-full w-[236px] rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
              Cancel
            </button>
            <button type='submit' className='h-full w-[236px] rounded-lg bg-brand text-center font-medium text-white'>
              Ok
            </button>
          </div>
        </ModalContent>
      </Modal>
      </>
  )
}
export { MonacoEditor }
