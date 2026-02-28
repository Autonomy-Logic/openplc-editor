import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { Modal, ModalContent, ModalTitle } from '@process:renderer/components/_molecules/modal'
import { openPLCStoreBase, useOpenPLCStore } from '@process:renderer/store'
import { PLCVariable } from '@root/types/PLC'
import { baseTypeSchema, type PLCPou } from '@root/types/PLC/open-plc'
import { getExtensionFromLanguage, getFolderFromPouType } from '@root/utils/PLC/pou-file-extensions'
import { parseHybridPouFromString, parseTextualPouFromString } from '@root/utils/PLC/pou-text-parser'
import type { IpcRendererEvent } from 'electron'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { toast } from '../../../[app]/toast/use-toast'
import {
  arduinoApiCompletion,
  cppSignatureHelp,
  cppSnippetsCompletion,
  cppStandardLibraryCompletion,
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
  language: 'il' | 'st' | 'python' | 'cpp'
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

// Cast window.bridge once for file-watcher methods that don't resolve in the renderer webpack context
const bridge = window.bridge as unknown as {
  fileWatchStart: (path: string) => Promise<{ success: boolean; error?: string }>
  fileWatchStop: (path: string) => Promise<{ success: boolean }>
  fileReadContent: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>
  onFileExternalChange: (handler: (event: IpcRendererEvent, data: { filePath: string }) => void) => () => void
}

// Replaces comment regions with spaces so column positions are preserved.
// Tracks block comment state across lines: (*..*), /*..*/, and // line comments.
type BlockCommentState = false | 'paren' | 'slash'
function stripLineComments(line: string, state: BlockCommentState): { stripped: string; state: BlockCommentState } {
  const chars = [...line]
  let i = 0
  let s = state

  while (i < chars.length) {
    if (s) {
      const endMarker = s === 'paren' ? ')' : '/'
      if (chars[i] === '*' && chars[i + 1] === endMarker) {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = false
      } else {
        chars[i] = ' '
        i++
      }
    } else {
      if (chars[i] === '/' && chars[i + 1] === '/') {
        for (let j = i; j < chars.length; j++) chars[j] = ' '
        break
      }
      if (chars[i] === '(' && chars[i + 1] === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = 'paren'
      } else if (chars[i] === '/' && chars[i + 1] === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = 'slash'
      } else {
        i++
      }
    }
  }

  return { stripped: chars.join(''), state: s }
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
      isDebuggerVisible,
      debugVariableValues,
      fbSelectedInstance,
      fbDebugInstances,
    },
    project: {
      meta: { path: projectPath },
      data: {
        pous,
        configuration: {
          resource: { globalVariables },
        },
        dataTypes,
      },
    },
    deviceDefinitions: {
      configuration: { deviceBoard },
    },
    libraries: sliceLibraries,
    editorActions: { saveEditorViewState },
    projectActions: { updatePou, createVariable },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
    snapshotActions: { addSnapshot },
  } = useOpenPLCStore()

  // Create a unique Monaco path by combining project path with relative path
  // This prevents Monaco from caching models across different projects with same POU names
  const uniqueMonacoPath = projectPath ? `${projectPath}${path}` : path

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [contentToDrop, setContentToDrop] = useState<PouToText>()
  const [newName, setNewName] = useState<string>('')
  const [localText, setLocalText] = useState<string>(() => {
    const pou = openPLCStoreBase.getState().project.data.pous.find((pou) => pou.data.name === name)
    return typeof pou?.data.body.value === 'string' ? pou.data.body.value : ''
  })
  const watchedFilePathRef = useRef<string | null>(null)

  useEffect(() => {
    const pou = pous.find((p) => p.data.name === name)
    const nextText = typeof pou?.data.body.value === 'string' ? pou.data.body.value : ''
    if (nextText !== localText) {
      setLocalText(nextText)
    }
  }, [name, language, pous, localText])

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
    if (language === 'cpp' && editorRef.current && pou) {
      injectCppTemplateIfNeeded(editorRef.current, pou, name)
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

  // File watching for external changes (auto-reload like VSCode)
  useEffect(() => {
    const projectPath = openPLCStoreBase.getState().project.meta.path
    if (!projectPath || !pou) return

    const actualExtension = getExtensionFromLanguage(language)
    const pouFolder = getFolderFromPouType(pou.type)

    // Construct full file path for the POU file
    const fullPath = `${projectPath}/pous/${pouFolder}/${name}${actualExtension}`
    watchedFilePathRef.current = fullPath

    // Start watching the file
    void bridge.fileWatchStart(fullPath)

    // Listen for external file change events - VSCode-like behavior:
    // - If file has no unsaved changes: auto-reload silently
    // - If file has unsaved changes: do nothing (preserve local edits)
    const handleExternalChange = (_event: IpcRendererEvent, data: { filePath: string }) => {
      if (data.filePath !== watchedFilePathRef.current) return

      // Check if the file has unsaved local changes
      const isSaved = openPLCStoreBase.getState().fileActions.getSavedState({ name })

      if (isSaved) {
        void reloadFromDisk()
      }
    }

    // Function to reload content from disk
    const reloadFromDisk = async () => {
      if (!watchedFilePathRef.current) return

      try {
        const result = await bridge.fileReadContent(watchedFilePathRef.current)

        if (result.success && result.content) {
          const parsedPou =
            language === 'st' || language === 'il'
              ? parseTextualPouFromString(result.content, language, pou.type)
              : parseHybridPouFromString(result.content, language, pou.type)
          const newBodyValue = typeof parsedPou.data.body.value === 'string' ? parsedPou.data.body.value : ''

          // Update local state and store
          setLocalText(newBodyValue)
          updatePou({ name, content: { language, value: newBodyValue } })
        }
      } catch (err) {
        console.error('[Monaco FileWatch] Failed to reload file:', err)
      }
    }

    const cleanup = bridge.onFileExternalChange(handleExternalChange)

    return () => {
      cleanup()
      if (watchedFilePathRef.current) {
        void bridge.fileWatchStop(watchedFilePathRef.current)
        watchedFilePathRef.current = null
      }
    }
  }, [pou?.type, name, language])

  // Update readOnly when debugger visibility changes on an already-mounted editor
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: isDebuggerVisible })
  }, [isDebuggerVisible])

  // Resolve FB instance context for composite key building
  const fbInstanceContext = useMemo(() => {
    if (!pou || pou.type !== 'function-block') return null
    const fbTypeKey = pou.data.name.toUpperCase()
    const selectedKey = fbSelectedInstance.get(fbTypeKey)
    if (!selectedKey) return null
    const instances = fbDebugInstances.get(fbTypeKey) || []
    return instances.find((inst) => inst.key === selectedKey) || null
  }, [pou, fbSelectedInstance, fbDebugInstances])

  // Debug inline value decorations for ST/IL editors
  useEffect(() => {
    if (!isDebuggerVisible || !editorRef.current || (language !== 'st' && language !== 'il')) {
      return
    }

    const editorInstance = editorRef.current
    const model = editorInstance.getModel()
    if (!model) return

    // Build variable expression → value entries from debugVariableValues keys matching this POU.
    // This naturally includes complex expressions like "TON0.Q" and "my_array[3]".
    const prefix = fbInstanceContext
      ? `${fbInstanceContext.programName}:${fbInstanceContext.fbVariableName}.`
      : `${name}:`

    const varEntries: Array<{ expr: string; value: string }> = []
    for (const [key, value] of debugVariableValues) {
      if (key.startsWith(prefix)) {
        varEntries.push({ expr: key.slice(prefix.length), value })
      }
    }

    if (varEntries.length === 0) return

    // Sort longest first so "TON0.Q" is matched before "TON0" on the same line
    varEntries.sort((a, b) => b.expr.length - a.expr.length)

    // Build per-expression regex: word boundary at start, negative lookahead at end
    // to prevent partial matches (e.g. "TON0" inside "TON0.Q")
    const exprPatterns = varEntries.map(({ expr, value }) => {
      const escaped = expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return { pattern: new RegExp(`\\b${escaped}(?![\\w.\\[])`, 'gi'), value }
    })

    const decorations: monaco.editor.IModelDeltaDecoration[] = []
    const lineCount = model.getLineCount()
    let blockCommentState: BlockCommentState = false

    for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
      const lineContent = model.getLineContent(lineNumber)
      const result = stripLineComments(lineContent, blockCommentState)
      blockCommentState = result.state
      const stripped = result.stripped

      // Track claimed column ranges to prevent overlapping decorations
      const claimed: Array<[number, number]> = []

      for (const { pattern, value } of exprPatterns) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(stripped)) !== null) {
          const startCol = match.index + 1
          const endCol = startCol + match[0].length

          // Skip if overlapping with an already-claimed range
          if (claimed.some(([s, e]) => startCol < e && endCol > s)) continue

          claimed.push([startCol, endCol])
          decorations.push({
            range: new monaco.Range(lineNumber, startCol, lineNumber, endCol),
            options: {
              after: {
                content: ` = ${value} `,
                inlineClassName: 'debug-inline-value',
              },
            },
          })
          break // Only first occurrence per expression per line
        }
      }
    }

    const collection = editorInstance.createDecorationsCollection(decorations)
    return () => collection.clear()
  }, [isDebuggerVisible, debugVariableValues, pou?.data.body.value, language, name, fbInstanceContext])

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
   * Note: Python uses its own LSP-based completion provider (pyright).
   * C/C++ uses Monaco's built-in language support. A full LSP (like clangd-wasm)
   * can be added in the future when a mature web-based solution is available.
   */
  useEffect(() => {
    if (language === 'python' || language === 'cpp') {
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

  /**
   * C/C++ completion provider
   * Provides autocomplete for standard library functions and code snippets
   * Conditionally includes Arduino API functions when an Arduino board is selected
   */
  const parseCppVariables = (code: string, range: monaco.IRange): monaco.languages.CompletionItem[] => {
    const variables = new Set<string>()

    const declarationPattern =
      /\b(?:const\s+)?(?:unsigned\s+|signed\s+)?(?:int|float|double|char|bool|long|short|void|auto|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|String)\s*\*?\s+(\w+)(?:\s*=|\s*;|\s*\[|\s*\()/g

    const paramPattern = /\(([^)]*)\)/g

    let match
    while ((match = declarationPattern.exec(code)) !== null) {
      const varName = match[1]
      if (varName && !['if', 'while', 'for', 'switch', 'return'].includes(varName)) {
        variables.add(varName)
      }
    }

    while ((match = paramPattern.exec(code)) !== null) {
      const params = match[1]
      if (params) {
        const paramList = params.split(',')
        paramList.forEach((param) => {
          const paramMatch = param.trim().match(/\b(\w+)\s*$/)
          if (paramMatch && paramMatch[1]) {
            variables.add(paramMatch[1])
          }
        })
      }
    }

    return Array.from(variables).map((varName) => ({
      label: varName,
      kind: monaco.languages.CompletionItemKind.Variable,
      detail: 'Local variable',
      insertText: varName,
      range,
    }))
  }

  useEffect(() => {
    if (language !== 'cpp') {
      return
    }

    const completionDisposable = monaco.languages.registerCompletionItemProvider('cpp', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const stdLibSuggestions = cppStandardLibraryCompletion({ range }).suggestions
        const snippetSuggestions = cppSnippetsCompletion({ range }).suggestions

        const isArduinoTarget = deviceBoard && !deviceBoard.includes('OpenPLC Runtime')
        const arduinoSuggestions = isArduinoTarget ? arduinoApiCompletion({ range }).suggestions : []

        const code = model.getValue()
        const variableSuggestions = parseCppVariables(code, range)

        const suggestions: monaco.languages.CompletionItem[] = [
          ...stdLibSuggestions,
          ...snippetSuggestions,
          ...arduinoSuggestions,
          ...variableSuggestions,
        ]

        return { suggestions }
      },
    })

    const signatureHelpDisposable = monaco.languages.registerSignatureHelpProvider('cpp', cppSignatureHelp)

    return () => {
      completionDisposable.dispose()
      signatureHelpDisposable.dispose()
    }
  }, [language, deviceBoard])

  function handleEditorDidMount(
    editorInstance: null | monaco.editor.IStandaloneCodeEditor,
    monacoInstance: null | typeof monaco,
  ) {
    editorRef.current = editorInstance
    monacoRef.current = monacoInstance

    if (!editorInstance || !monacoInstance) return

    // Force-sync cached Monaco model with the store value.
    // @monaco-editor/react's useUpdate skips the value→model sync on initial mount,
    // so when keepCurrentModel=true a stale model from a previous session may persist
    // (e.g. after "Don't Save" → reopen). At this point the onChange listener hasn't
    // been wired up yet, so setValue won't trigger handleWriteInPou.
    const model = editorInstance.getModel()
    if (model) {
      const storePou = openPLCStoreBase.getState().project.data.pous.find((p) => p.data.name === name)
      const storeBodyValue = typeof storePou?.data.body.value === 'string' ? storePou.data.body.value : ''
      if (model.getValue() !== storeBodyValue) {
        model.setValue(storeBodyValue)
      }
    }

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

    // Check for external file changes when tab becomes active (editor mounts)
    // This handles the case where a file was modified while another tab was in focus
    void (async () => {
      const isSaved = openPLCStoreBase.getState().fileActions.getSavedState({ name })
      if (!isSaved) return // Has local unsaved changes, don't reload

      const currentPou = openPLCStoreBase.getState().project.data.pous.find((p) => p.data.name === name)
      if (!currentPou) return

      const projectPath = openPLCStoreBase.getState().project.meta.path
      if (!projectPath) return

      // Construct file path
      const actualExtension = getExtensionFromLanguage(language)
      const pouFolder = getFolderFromPouType(currentPou.type)
      const fullPath = `${projectPath}/pous/${pouFolder}/${name}${actualExtension}`

      try {
        const result = await bridge.fileReadContent(fullPath)

        if (result.success && result.content) {
          const parsedPou =
            language === 'st' || language === 'il'
              ? parseTextualPouFromString(result.content, language, currentPou.type)
              : parseHybridPouFromString(result.content, language, currentPou.type)
          const newBodyValue = typeof parsedPou.data.body.value === 'string' ? parsedPou.data.body.value : ''

          // Only update if content is different from what we have
          const currentBodyValue = typeof currentPou.data.body.value === 'string' ? currentPou.data.body.value : ''
          if (newBodyValue !== currentBodyValue) {
            setLocalText(newBodyValue)
            updatePou({ name, content: { language, value: newBodyValue } })
          }
        }
      } catch (err) {
        console.error('[Monaco] Failed to check for external changes on mount:', err)
      }
    })()

    if (searchQuery) {
      moveToMatch(editorInstance, searchQuery, sensitiveCase, regularExpression)
    }

    if (editor.cursorPosition) {
      editorInstance.setPosition(editor.cursorPosition)
      editorInstance.revealPositionInCenter(editor.cursorPosition)
    }

    if (editor.scrollPosition) {
      editorInstance.setScrollTop(editor.scrollPosition.top)
      editorInstance.setScrollLeft(editor.scrollPosition.left)
    }

    if (language === 'python' && pou) {
      injectPythonTemplateIfNeeded(editorInstance, pou, name)
      initPythonLSP(monacoInstance)
        .then(() => setupPythonLSPForEditor(editorInstance))
        .catch((err: unknown) => console.warn('[Python LSP]', err instanceof Error ? err.message : err))
    }

    if (language === 'cpp' && pou) {
      injectCppTemplateIfNeeded(editorInstance, pou, name)
    }

    editorInstance.focus()
  }

  function injectPythonTemplateIfNeeded(editor: monaco.editor.IStandaloneCodeEditor, pou: PLCPou, pouName: string) {
    const editorModel = editor.getModel()
    if (!editorModel) return

    const stateValue = pou.data.body.value as string
    const stateIsEmpty = !stateValue || stateValue.trim() === ''
    const alreadyInjected = templatesInjected.has(pouName)

    const shouldInjectTemplate = stateIsEmpty && !alreadyInjected

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

  function injectCppTemplateIfNeeded(editor: monaco.editor.IStandaloneCodeEditor, pou: PLCPou, pouName: string) {
    const editorModel = editor.getModel()
    if (!editorModel) return

    const stateValue = pou.data.body.value as string
    const stateIsEmpty = !stateValue || stateValue.trim() === ''
    const alreadyInjected = templatesInjected.has(pouName)

    const shouldInjectTemplate = stateIsEmpty && !alreadyInjected

    if (shouldInjectTemplate) {
      const cppTemplate = `/* ================================================================
 *  C/C++ FUNCTION BLOCK
 *
 *  ---------------------------------------------------------------
 *  - This function block runs **in sync** with the PLC runtime.
 *  - The \`setup()\` function is called once when the block initializes.
 *  - The \`loop()\` function is called at every PLC scan cycle.
 *  - Block input and output variables declared in the variable table
 *    can be accessed directly by name in this C/C++ code.
 *
 *  This block executes as part of the main PLC process and follows
 *  the configured scan time in the Resources. Use it for real-time
 *  control logic, fast I/O operations, or any C-based algorithms.
 * ================================================================ */

#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

// Called once when the block is initialized
void setup()
{

}

// Called at every PLC scan cycle
void loop()
{

}
`

      editor.setValue(cppTemplate)
      handleWriteInPou(cppTemplate)

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
    readOnly: isDebuggerVisible,
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
      <div id='editor drop handler' className='oplc-monaco-wrapper h-full w-full' onDrop={handleDrop}>
        <PrimitiveEditor
          options={monacoEditorUserOptions}
          height='100%'
          width='100%'
          path={uniqueMonacoPath}
          language={language}
          defaultValue={''}
          value={localText}
          onMount={handleEditorDidMount}
          onChange={handleWriteInPou}
          theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
          // Disabled: view state (cursor/scroll) is managed manually via Zustand store.
          // Monaco's built-in saveViewState causes "Canceled" errors from WordHighlighter
          // when restoring state on language switches (e.g., ST to Python).
          saveViewState={false}
          keepCurrentModel={true}
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
