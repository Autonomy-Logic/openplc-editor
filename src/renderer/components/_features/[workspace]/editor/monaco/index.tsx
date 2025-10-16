import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { Modal, ModalContent, ModalTitle } from '@process:renderer/components/_molecules/modal'
import { openPLCStoreBase, useOpenPLCStore } from '@process:renderer/store'
import { PLCVariable } from '@root/types/PLC'
import { baseTypeSchema, type PLCPou } from '@root/types/PLC/open-plc'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, useState } from 'react'

import { toast } from '../../../[app]/toast/use-toast'
import {
  keywordsCompletion,
  libraryCompletion,
  snippetsSTCompletion,
  tableGlobalVariablesCompletion,
  tableVariablesCompletion,
} from './completion'
import { dataTypeCompletion } from './completion/datatype.completion'
import { fbCompletion } from './completion/fb.completion'
import {
  updateDataTypeVariablesInTokenizer,
  updateEnumValuesInTokenizer,
  updateLocalVariablesInTokenizer,
} from './configs/languages/st/st'
import { parsePouToStText } from './drag-and-drop/st'
import { cleanupPythonLSP, initPythonLSP, setupPythonLSPForEditor } from './python-lsp'

type monacoEditorProps = {
  path: string
  name: string
  language: 'il' | 'st' | 'python'
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

type SnippetController = {
  insert: (snippet: string, options?: unknown) => void
}

const MonacoEditor = (props: monacoEditorProps): ReturnType<typeof PrimitiveEditor> => {
  const { language, path, name } = props
  const editorRef = useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const monacoRef = useRef<null | typeof monaco>(null)
  const focusDisposables = useRef<{ onFocus?: monaco.IDisposable; onBlur?: monaco.IDisposable }>({})

  const {
    editor,
    searchQuery,
    sensitiveCase,
    regularExpression,
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    project: {
      data: {
        pous,
        configuration: {
          resource: { globalVariables },
        },
        dataTypes,
      },
    },
    libraries: sliceLibraries,
    editorActions: { saveEditorViewState },
    projectActions: { updatePou, createVariable },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
    snapshotActions: { addSnapshot },
  } = useOpenPLCStore()

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [contentToDrop, setContentToDrop] = useState<PouToText>()
  const [newName, setNewName] = useState<string>('')
  const [localText, setLocalText] = useState<string>(() => {
    const pou = openPLCStoreBase.getState().project.data.pous.find((pou) => pou.data.name === name)
    return typeof pou?.data.body.value === 'string' ? pou.data.body.value : ''
  })

  useEffect(() => {
    const pou = openPLCStoreBase.getState().project.data.pous.find((p) => p.data.name === name)
    setLocalText(typeof pou?.data.body.value === 'string' ? pou.data.body.value : '')
  }, [name, language])

  const [templatesInjected, setTemplatesInjected] = useState<Set<string>>(new Set())

  const pou = pous.find((pou) => pou.data.name === name)

  useEffect(() => {
    if (editorRef.current && searchQuery) {
      moveToMatch(editorRef.current, searchQuery, sensitiveCase, regularExpression)
    }
  }, [searchQuery, sensitiveCase, regularExpression])

  useEffect(() => {
    if (language === 'st' && pou?.data.variables) {
      const variableNames = pou.data.variables
        .filter((variable) => variable.name && variable.name.trim() !== '')
        .map((variable) => variable.name)

      updateLocalVariablesInTokenizer(variableNames)
    }
  }, [pou?.data.variables, language])

  useEffect(() => {
    // Handle template injection when POU changes (for already mounted editors)
    if (language === 'python' && editorRef.current && pou) {
      injectPythonTemplateIfNeeded(editorRef.current, pou, name)
    }
  }, [pou])

  useEffect(() => {
    return () => {
      setTemplatesInjected((prev) => {
        const newSet = new Set(prev)
        newSet.delete(name)
        return newSet
      })

      if (language === 'python') {
        cleanupPythonLSP()
      }
    }
  }, [name, language])

  useEffect(() => {
    if (language === 'st' && dataTypes.length > 0) {
      updateDataTypeVariablesInTokenizer(dataTypes)
      updateEnumValuesInTokenizer(dataTypes)
    }
  }, [dataTypes, language])

  const variablesSuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = tableVariablesCompletion({
        range,
        variables: (pou?.data.variables || []) as PLCVariable[],
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [pou?.data.variables],
  )

  const globalVariablesSuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = tableGlobalVariablesCompletion({
        range,
        variables: globalVariables as PLCVariable[],
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [globalVariables],
  )

  const librarySuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = libraryCompletion({
        range,
        library: sliceLibraries,
        pous,
        editor,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [sliceLibraries],
  )

  const fbSuggestions = useCallback(
    (range: monaco.IRange, model: monaco.editor.ITextModel, position: monaco.IPosition) => {
      // Filter custom function blocks from POUs
      const customFBs = pous.filter((pou) => pou.type === 'function-block')

      const suggestions = fbCompletion({
        model,
        position,
        range,
        pouVariables: pou?.data.variables || [],
        customFBs,
        editorName: name,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [pou?.data.variables, pous],
  )

  const dataTypeSuggestions = useCallback(
    (range: monaco.IRange, model: monaco.editor.ITextModel, position: monaco.IPosition) => {
      // Use data types from project data (not from POUs)

      const suggestions = dataTypeCompletion({
        model,
        position,
        range,
        pouVariables: pou?.data.variables || [],
        customDataTypes: dataTypes,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [dataTypes, pou?.data.variables],
  )

  const keywordsSuggestions = useCallback(
    (range: monaco.IRange) => {
      const allSuggestions = keywordsCompletion({
        range,
        language: language as 'st' | 'il',
      }).suggestions

      let filteredSuggestions = allSuggestions
      let filteredLabels = allSuggestions.map((suggestion) => suggestion.label)
      let uniqueSuggestions = allSuggestions

      if (language === 'st') {
        const stSnippetLabels = [
          'if',
          'ifelse',
          'ifelseif',
          'for',
          'while',
          'repeat',
          'case',
          'program',
          'function',
          'function_block',
          'var',
          'var_input',
          'var_output',
          'array',
          'struct',
          'comment_block',
        ]

        filteredSuggestions = allSuggestions.filter(
          (suggestion) => !stSnippetLabels.includes(suggestion.label.toLowerCase()),
        )

        uniqueSuggestions = Array.from(new Map(filteredSuggestions.map((s) => [s.label, s])).values())
        filteredLabels = uniqueSuggestions.map((suggestion) => suggestion.label)
      }

      return {
        suggestions: uniqueSuggestions,
        labels: filteredLabels,
      }
    },
    [language],
  )

  const snippetsSTSuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = snippetsSTCompletion({
        range,
        language: language as 'st' | 'il',
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [language],
  )

  /**
   * Update the auto-completion feature of the monaco editor.
   * Note: Python uses its own LSP-based completion provider
   */
  useEffect(() => {
    if (language === 'python') {
      return
    }

    const disposable = monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })

        const dotAccessMatch = textUntilPosition.match(/(\w+)\.$/)
        if (dotAccessMatch) {
          const variableName = dotAccessMatch[1]

          const primitiveTypes: string[] = baseTypeSchema.options

          const allVariables = [...(pou?.data.variables ?? []), ...(globalVariables ?? [])]

          const variable = allVariables.find((v) => v.name === variableName)

          if (variable && primitiveTypes.includes(variable.type.value)) {
            return { suggestions: [] }
          }
        }

        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const linesContent: Array<string[]> = []
        model.getLinesContent().forEach((line) => {
          linesContent.push(line.trim().split(' '))
        })

        const identifierTokens = linesContent.flat().flatMap((token) => {
          return token.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || []
        })

        const identifiers = Array.from(
          new Set(
            identifierTokens
              .map((token) => {
                if (
                  snippetsSTSuggestions(range).labels.includes(token) ||
                  variablesSuggestions(range).labels.includes(token) ||
                  globalVariablesSuggestions(range).labels.includes(token) ||
                  librarySuggestions(range).labels.includes(token) ||
                  keywordsSuggestions(range).labels.includes(token) ||
                  fbSuggestions(range, model, position).labels.includes(token) ||
                  dataTypeSuggestions(range, model, position).labels.includes(token)
                ) {
                  return null
                }
                return token
              })
              .filter((suggestion) => suggestion !== null),
          ),
        )
        const identifiersSuggestions = identifiers.map((identifier) => ({
          label: identifier,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: identifier,
          range,
        }))

        const suggestions = [
          ...fbSuggestions(range, model, position).suggestions,
          ...dataTypeSuggestions(range, model, position).suggestions,
          ...snippetsSTSuggestions(range).suggestions,
          ...variablesSuggestions(range).suggestions,
          ...globalVariablesSuggestions(range).suggestions,
          ...librarySuggestions(range).suggestions,
          ...keywordsSuggestions(range).suggestions,
          ...identifiersSuggestions,
        ]
        const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())

        return { suggestions: uniqueSuggestions }
      },
    })
    return () => disposable.dispose()
  }, [pou?.data.variables, globalVariables, sliceLibraries, language, snippetsSTSuggestions])

  function handleEditorDidMount(
    editorInstance: null | monaco.editor.IStandaloneCodeEditor,
    monacoInstance: null | typeof monaco,
  ) {
    editorRef.current = editorInstance
    monacoRef.current = monacoInstance

    if (!editorInstance || !monacoInstance) return

    // Existing functionality for other languages
    focusDisposables.current.onFocus?.dispose()
    focusDisposables.current.onBlur?.dispose()

    if (editorInstance) {
      focusDisposables.current.onFocus = editorInstance.onDidFocusEditorText(() => {
        openPLCStoreBase.getState().editorActions.setMonacoFocused(true)
      })

      focusDisposables.current.onBlur = editorInstance.onDidBlurEditorText(() => {
        openPLCStoreBase.getState().editorActions.setMonacoFocused(false)
      })
    }

    if (searchQuery) {
      moveToMatch(editorInstance, searchQuery, sensitiveCase, regularExpression)
    }

    // Restore cursor and scroll position for non-Python languages
    if (editor.cursorPosition && language !== 'python') {
      editorInstance.setPosition(editor.cursorPosition)
      editorInstance.revealPositionInCenter(editor.cursorPosition)
    }

    if (editor.scrollPosition && language !== 'python') {
      editorInstance.setScrollTop(editor.scrollPosition.top)
      editorInstance.setScrollLeft(editor.scrollPosition.left)
    }

    if (language === 'python' && pou) {
      injectPythonTemplateIfNeeded(editorInstance, pou, name)

      void initPythonLSP(monacoInstance).then(() => setupPythonLSPForEditor(editorInstance))
    }

    editorInstance.focus()
  }

  function injectPythonTemplateIfNeeded(editor: monaco.editor.IStandaloneCodeEditor, pou: PLCPou, pouName: string) {
    const editorModel = editor.getModel()
    if (!editorModel) return

    const stateValue = pou.data.body.value as string
    const editorValue = editorModel.getValue()

    const stateIsEmpty = !stateValue || stateValue.trim() === ''
    const editorIsEmpty = !editorValue || editorValue.trim() === ''
    const alreadyInjected = templatesInjected.has(pouName)

    const shouldInjectTemplate = stateIsEmpty && editorIsEmpty && !alreadyInjected

    if (shouldInjectTemplate) {
      const pythonTemplate = `# ================================================================
# DISCLAIMER: Python Function Block Execution
#
# This block runs asynchronously from the main PLC runtime.
# ---------------------------------------------------------------
# - All variables are shared with the runtime through shared memory.
# - The block_init() function is called once when the block starts.
# - The block_loop() function is called periodically (~100ms).
# - IMPORTANT: This periodic call DOES NOT follow the PLC scan cycle.
#   It is NOT guaranteed that block_loop() will execute once per scan.
#
# Use this block for non-time-critical tasks. For logic that must
# match the PLC scan cycle, use standard IEC 61131-3 function blocks.
# ================================================================

from multiprocessing import shared_memory
import struct
import time
import os

def block_init():
    print('Block was initialized')

def block_loop():
    print('Block has run the loop function')
`

      editor.setValue(pythonTemplate)
      handleWriteInPou(pythonTemplate)

      // Position cursor at the end
      const lineCount = editorModel.getLineCount()
      const lastLineContent = editorModel.getLineContent(lineCount)
      const position = {
        lineNumber: lineCount,
        column: lastLineContent.length + 1,
      }
      editor.setPosition(position)

      setTemplatesInjected((prev) => new Set(prev).add(pouName))
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
    if (value === undefined) return

    setLocalText(value)
    handleFileAndWorkspaceSavedState(name)
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
      const pou = pous.find((pou) => pou.data.name === libraryToUse?.name)
      if (!pou) return
      pouToAppend = {
        name: pou.data.name,
        type: pou.type,
        variables: pou.data.variables.map((variable) => ({
          name: variable.name,
          class: variable.class,
          type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
        })),
        documentation: pou.data.documentation,
        extensible: false,
      }
    }

    setContentToDrop(pouToAppend as PouToText)

    if (pouToAppend?.type === 'function') {
      const contentToInsert = parsePouToStText(pouToAppend as PouToText)

      const snippetController = editorRef.current?.getContribution('snippetController2') as unknown as SnippetController
      if (snippetController) {
        snippetController.insert(contentToInsert)
      }
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

    addSnapshot(editor.meta.name)

    const currentEditor = pous.find((pou) => pou.data.name === editor.meta.name)
    if (!currentEditor) return

    const existingNames = currentEditor.data.variables.map((variable) => variable.name)
    const uniqueName = checkIfVariableExists(existingNames, newName)

    const renamedContent = { ...contentToDrop, name: uniqueName }
    const contentToInsert = parsePouToStText(renamedContent)

    const snippetController = editorRef.current.getContribution('snippetController2') as unknown as SnippetController
    if (snippetController) {
      snippetController.insert(contentToInsert)
    }

    setIsOpen(false)
    setNewName('')

    const res = createVariable({
      data: {
        id: crypto.randomUUID(),
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

  useEffect(() => {
    const unsub = openPLCStoreBase.subscribe(
      (state) => state.editor.meta.name,
      (newName, prevEditorName) => {
        if (newName === prevEditorName || !editorRef.current) return

        const editor = editorRef.current
        const model = editor.getModel()
        const pos = editor.getPosition()
        const offset = pos && model?.getOffsetAt(pos)

        const cursorPosition = pos && offset ? { lineNumber: pos.lineNumber, column: pos.column, offset } : undefined

        const scrollPosition = {
          top: editor.getScrollTop(),
          left: editor.getScrollLeft(),
        }

        saveEditorViewState({ prevEditorName, cursorPosition, scrollPosition })
      },
    )

    return () => unsub()
  }, [])

  return (
    <>
      <div id='editor drop handler' className='h-full w-full' onDrop={handleDrop}>
        <PrimitiveEditor
          options={monacoEditorUserOptions}
          height='100%'
          width='100%'
          path={path}
          language={language}
          defaultValue={''}
          value={localText}
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
