import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { baseTypeSchema } from '../../../../../../middleware/shared/ports/plc-schemas'
import type { PLCPou } from '../../../../../../middleware/shared/ports/types'
import { useAI, useCapabilities, useProject } from '../../../../../../middleware/shared/providers'
import { applyAcceptedHunks, computeHunks, type DiffHunk } from '../../../../../utils/ai-diff-review'
import { useDebugBoolValuesMap, useDebugNonBoolValuesMap } from '../../../../../hooks/use-debug-value'
import { executeSaveActiveFile, executeSaveProject } from '../../../../../services/save-actions'
import { openPLCStoreBase, useOpenPLCStore } from '../../../../../store'
import { getExtensionFromLanguage, getFolderFromPouType } from '../../../../../utils/PLC/pou-file-extensions'
import { parseHybridPouFromString, parseTextualPouFromString } from '../../../../../utils/PLC/pou-text-parser'
import { Modal, ModalContent, ModalTitle } from '../../../../_molecules/modal'
import { toast } from '../../../[app]/toast/use-toast'
import { renderDiffReview } from './ai-diff-review'
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
import { applyThemeNow, ensureOpenplcThemes } from './theme-utils'

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

// ---------------------------------------------------------------------------
// Comment stripping (for debug variable position scanning)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Module-level flag for initial theme application
// ---------------------------------------------------------------------------

let didApplyInitialTheme = false

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MonacoEditor = (props: monacoEditorProps): ReturnType<typeof PrimitiveEditor> => {
  const { language, path, name } = props
  const editorRef = useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const monacoRef = useRef<null | typeof monaco>(null)
  const focusDisposables = useRef<{ onFocus?: monaco.IDisposable; onBlur?: monaco.IDisposable }>({})
  const [editorMounted, setEditorMounted] = useState(false)
  const [modelVersion, setModelVersion] = useState(0)
  const isSyncingModelRef = useRef(false)

  const capabilities = useCapabilities()
  const aiPort = useAI()
  const projectPort = useProject()

  const {
    editor,
    searchQuery,
    sensitiveCase,
    regularExpression,
    workspace: {
      systemConfigs: { shouldUseDarkMode },
      isDebuggerVisible,
      fbSelectedInstance,
      fbDebugInstances,
    },
    project: {
      meta: { path: projectPath },
      data: {
        pous,
        configurations: {
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
    snapshotActions: { pushToHistory },
  } = useOpenPLCStore()
  const debugBoolValues = useDebugBoolValuesMap()
  const debugNonBoolValues = useDebugNonBoolValuesMap()

  // Create a unique Monaco path for editor (prevents model caching across projects)
  const uniqueMonacoPath = capabilities.hasLocalFilesystem && projectPath ? `${projectPath}${path}` : path

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [contentToDrop, setContentToDrop] = useState<PouToText>()
  const [newName, setNewName] = useState<string>('')
  const [localText, setLocalText] = useState<string>(() => {
    const pou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === name)
    return typeof pou?.body.value === 'string' ? pou.body.value : ''
  })
  const watchedFilePathRef = useRef<string | null>(null)

  // AI diff review state — per-hunk inline review with keep/undo buttons
  const [diffReview, setDiffReview] = useState<{
    active: boolean
    oldBody: string
    newBody: string
    hunks: DiffHunk[]
    acceptedHunks: Set<string>
  } | null>(null)

  const [templatesInjected, setTemplatesInjected] = useState<Set<string>>(new Set())

  const pou = pous.find((p) => p.name === name)
  const pouVariables = pou?.interface?.variables ?? []

  // Sync local text when POU identity changes
  useEffect(() => {
    const currentPou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === name)
    const newContent = typeof currentPou?.body.value === 'string' ? currentPou.body.value : ''
    setLocalText(newContent)
  }, [name, language, path])

  // Also sync when pous changes in store (for external updates)
  useEffect(() => {
    const nextText = typeof pou?.body.value === 'string' ? pou.body.value : ''
    if (nextText !== localText) {
      setLocalText(nextText)
    }
  }, [name, language, pous])

  // Render/clear diff review decorations when state changes
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (!diffReview?.active || diffReview.hunks.length === 0) return () => {}

    // Get only pending (unresolved) hunks
    const pendingHunks = diffReview.hunks.filter((h) => diffReview.acceptedHunks.has(h.id))
    if (pendingHunks.length === 0) {
      // All hunks resolved — exit diff review
      setDiffReview(null)
      return () => {}
    }

    const handleKeepHunk = (hunkId: string) => {
      // "Keep" = accept this hunk (new code stays), remove from pending
      setDiffReview((prev) => {
        if (!prev) return prev
        const newAccepted = new Set(prev.acceptedHunks)
        newAccepted.delete(hunkId) // Remove from pending set = resolved as kept
        const remaining = prev.hunks.filter((h) => newAccepted.has(h.id))
        if (remaining.length === 0) return null // All resolved
        return { ...prev, acceptedHunks: newAccepted }
      })
    }

    const handleUndoHunk = (hunkId: string) => {
      // "Undo" = reject this hunk, revert those lines to old version
      setDiffReview((prev) => {
        if (!prev) return prev
        const newAccepted = new Set(prev.acceptedHunks)
        newAccepted.delete(hunkId)

        // Rebuild body: accepted hunks keep new code, this rejected hunk keeps old code
        const keptIds = new Set<string>()
        for (const h of prev.hunks) {
          if (h.id === hunkId) continue // This one is undone
          if (!newAccepted.has(h.id)) {
            // Already resolved as kept
            keptIds.add(h.id)
          } else {
            // Still pending — treat as kept for now (new code)
            keptIds.add(h.id)
          }
        }

        const newBody = applyAcceptedHunks(prev.oldBody, prev.newBody, prev.hunks, keptIds)

        // Update editor model with rebuilt body
        const model = editor.getModel()
        if (model) {
          isSyncingModelRef.current = true
          const fullRange = model.getFullModelRange()
          editor.executeEdits('ai-diff-undo-hunk', [{ range: fullRange, text: newBody }])
          isSyncingModelRef.current = false
        }
        setLocalText(newBody)

        // Update store
        const state = openPLCStoreBase.getState()
        state.projectActions.updatePou({ name, content: { language, value: newBody } })

        // Recompute hunks for remaining pending changes
        const remainingHunks = prev.hunks.filter((h) => newAccepted.has(h.id))
        if (remainingHunks.length === 0) return null

        // Recompute line positions for remaining hunks
        const freshHunks = computeHunks(prev.oldBody, newBody)
        const freshAccepted = new Set(freshHunks.map((h) => h.id))

        if (freshHunks.length === 0) return null
        return { ...prev, newBody, hunks: freshHunks, acceptedHunks: freshAccepted }
      })
    }

    const cleanup = renderDiffReview(editor, pendingHunks, handleKeepHunk, handleUndoHunk)
    return cleanup
  }, [diffReview, name, language])

  useEffect(() => {
    if (editorRef.current && searchQuery) {
      moveToMatch(editorRef.current, searchQuery, sensitiveCase, regularExpression)
    }
  }, [searchQuery, sensitiveCase, regularExpression])

  useEffect(() => {
    if (language === 'st' && pouVariables.length > 0) {
      const variableNames = pouVariables
        .filter((variable) => variable.name && variable.name.trim() !== '')
        .map((variable) => variable.name)

      updateLocalVariablesInTokenizer(variableNames)
    }
  }, [pouVariables, language])

  // Template injection when POU changes (for already mounted editors)
  useEffect(() => {
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

      if (capabilities.hasPythonLSP && language === 'python') {
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

  // -----------------------------------------------------------------------
  // File watching for external changes (editor-only, gated by hasFileWatcher)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!capabilities.hasFileWatcher) return

    const currentProjectPath = openPLCStoreBase.getState().project.meta.path
    if (!currentProjectPath || !pou) return

    if (!projectPort.watchFile || !projectPort.onFileExternalChange) return

    const actualExtension = getExtensionFromLanguage(language)
    const pouFolder = getFolderFromPouType(pou.pouType)
    const fullPath = `${currentProjectPath}/pous/${pouFolder}/${name}${actualExtension}`
    watchedFilePathRef.current = fullPath

    void projectPort.watchFile(fullPath)

    const handleExternalChange = (filePath: string) => {
      if (filePath !== watchedFilePathRef.current) return

      const isSaved = openPLCStoreBase.getState().fileActions.getSavedState({ name })
      if (isSaved) {
        void reloadFromDisk()
      }
    }

    const reloadFromDisk = async () => {
      if (!watchedFilePathRef.current) return

      try {
        const result = await projectPort.readFileContent(watchedFilePathRef.current)

        if (result.success && result.content) {
          const parsedPou =
            language === 'st' || language === 'il'
              ? parseTextualPouFromString(result.content, language, pou.pouType)
              : parseHybridPouFromString(result.content, language, pou.pouType)
          const newBodyValue = typeof parsedPou.body.value === 'string' ? parsedPou.body.value : ''

          setLocalText(newBodyValue)
          updatePou({ name, content: { language, value: newBodyValue } })
        }
      } catch (err) {
        console.error('[Monaco FileWatch] Failed to reload file:', err)
      }
    }

    const cleanup = projectPort.onFileExternalChange(handleExternalChange)

    return () => {
      cleanup()
      if (watchedFilePathRef.current) {
        void projectPort.unwatchFile?.(watchedFilePathRef.current)
        watchedFilePathRef.current = null
      }
    }
  }, [pou?.pouType, name, language, capabilities.hasFileWatcher])

  // Track when @monaco-editor/react switches models (tab changes with keepCurrentModel).
  // onMount only fires once on initial mount, so we use onDidChangeModel to detect when the
  // model has actually switched, then bump modelVersion to trigger debugVarPositions recomputation.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const disposable = editor.onDidChangeModel(() => {
      setModelVersion((v) => v + 1)
    })
    return () => disposable.dispose()
  }, [editorMounted])

  // Update readOnly when debugger visibility changes (editor-only)
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: isDebuggerVisible })
  }, [isDebuggerVisible])

  // -----------------------------------------------------------------------
  // Debug variable inline values (editor-only debugger feature)
  // -----------------------------------------------------------------------

  const fbInstanceContext = useMemo(() => {
    if (!pou || pou.pouType !== 'function-block') return null
    const fbTypeKey = pou.name.toUpperCase()
    const selectedKey = fbSelectedInstance.get(fbTypeKey)
    if (!selectedKey) return null
    const instances = fbDebugInstances.get(fbTypeKey) || []
    return instances.find((inst) => inst.key === selectedKey) || null
  }, [pou, fbSelectedInstance, fbDebugInstances])

  const debugVarKeySet = useMemo(() => {
    const keys: string[] = []
    for (const key of debugBoolValues.keys()) keys.push(key)
    for (const key of debugNonBoolValues.keys()) keys.push(key)
    return keys.sort().join('\0')
  }, [debugBoolValues, debugNonBoolValues])

  const debugVarPositions = useMemo(() => {
    if (!isDebuggerVisible || !editorRef.current || !monacoRef.current || (language !== 'st' && language !== 'il'))
      return null

    const model = editorRef.current.getModel()
    if (!model) return null

    // Guard: ensure the model matches the current POU. During tab switches the memo may
    // fire before @monaco-editor/react has swapped the model, so we'd scan the wrong file.
    const expectedUri = monacoRef.current.Uri.file(uniqueMonacoPath).toString()
    if (model.uri.toString() !== expectedUri) return null

    const prefix = fbInstanceContext
      ? `${fbInstanceContext.programName}:${fbInstanceContext.fbVariableName}.`
      : `${name}:`

    const varNames: string[] = []
    for (const key of debugBoolValues.keys()) {
      if (key.startsWith(prefix)) varNames.push(key.slice(prefix.length))
    }
    for (const key of debugNonBoolValues.keys()) {
      if (key.startsWith(prefix)) varNames.push(key.slice(prefix.length))
    }
    if (varNames.length === 0) return null

    varNames.sort((a, b) => b.length - a.length)

    const exprPatterns = varNames.map((expr) => {
      const escaped = expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return { expr, pattern: new RegExp(`\\b${escaped}(?![\\w.\\[])`, 'gi') }
    })

    const positions: Array<{ expr: string; line: number; startCol: number; endCol: number }> = []
    let blockCommentState: BlockCommentState = false

    for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
      const result = stripLineComments(model.getLineContent(lineNumber), blockCommentState)
      blockCommentState = result.state
      const claimed: Array<[number, number]> = []

      for (const { expr, pattern } of exprPatterns) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(result.stripped)) !== null) {
          const startCol = match.index + 1
          const endCol = startCol + match[0].length
          if (claimed.some(([s, e]) => startCol < e && endCol > s)) continue
          claimed.push([startCol, endCol])
          positions.push({ expr, line: lineNumber, startCol, endCol })
          break
        }
      }
    }

    return { prefix, positions }
  }, [isDebuggerVisible, debugVarKeySet, language, name, fbInstanceContext, editorMounted, modelVersion])

  useEffect(() => {
    if (!debugVarPositions || !editorRef.current) return

    const { prefix, positions } = debugVarPositions
    const decorations: monaco.editor.IModelDeltaDecoration[] = positions.map(({ expr, line, startCol, endCol }) => ({
      range: new monaco.Range(line, startCol, line, endCol),
      options: {
        after: {
          content: ` = ${debugBoolValues.get(prefix + expr) ?? debugNonBoolValues.get(prefix + expr) ?? '?'} `,
          inlineClassName: 'debug-inline-value',
        },
      },
    }))

    const collection = editorRef.current.createDecorationsCollection(decorations)
    return () => collection.clear()
  }, [debugVarPositions, debugBoolValues, debugNonBoolValues])

  // -----------------------------------------------------------------------
  // Completion callbacks
  // -----------------------------------------------------------------------

  const variablesSuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = tableVariablesCompletion({
        range,
        variables: pouVariables,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return { suggestions: uniqueSuggestions, labels }
    },
    [pouVariables],
  )

  const globalVariablesSuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = tableGlobalVariablesCompletion({
        range,
        variables: globalVariables,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return { suggestions: uniqueSuggestions, labels }
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
      return { suggestions: uniqueSuggestions, labels }
    },
    [sliceLibraries],
  )

  const fbSuggestions = useCallback(
    (range: monaco.IRange, model: monaco.editor.ITextModel, position: monaco.IPosition) => {
      const customFBs = pous.filter((p) => p.pouType === 'function-block')

      const suggestions = fbCompletion({
        model,
        position,
        range,
        pouVariables,
        customFBs,
        editorName: name,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return { suggestions: uniqueSuggestions, labels }
    },
    [pouVariables, pous],
  )

  const dataTypeSuggestions = useCallback(
    (range: monaco.IRange, model: monaco.editor.ITextModel, position: monaco.IPosition) => {
      const suggestions = dataTypeCompletion({
        model,
        position,
        range,
        pouVariables,
        customDataTypes: dataTypes,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return { suggestions: uniqueSuggestions, labels }
    },
    [dataTypes, pouVariables],
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

      return { suggestions: uniqueSuggestions, labels: filteredLabels }
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
      return { suggestions: uniqueSuggestions, labels }
    },
    [language],
  )

  // -----------------------------------------------------------------------
  // ST/IL completion provider
  // -----------------------------------------------------------------------

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
          const allVariables = [...pouVariables, ...(globalVariables ?? [])]
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
  }, [pouVariables, globalVariables, sliceLibraries, language, snippetsSTSuggestions])

  // -----------------------------------------------------------------------
  // C/C++ completion provider
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // AI inline completion provider (gated by hasAIAssistant)
  // -----------------------------------------------------------------------

  const aiState = useOpenPLCStore().ai

  useEffect(() => {
    if (!capabilities.hasAIAssistant) return
    if (!aiState.isEnabled) return
    if (!aiState.hasConsented) return

    if (!aiPort?.registerInlineCompletions) return

    const registration = aiPort.registerInlineCompletions({
      monacoInstance: monaco,
      pouName: name,
      language,
    })

    return () => registration.dispose()
  }, [name, language, aiState.isEnabled, aiState.hasConsented, capabilities.hasAIAssistant, aiPort])

  // -----------------------------------------------------------------------
  // Theme management
  // -----------------------------------------------------------------------

  function handleEditorBeforeMount(monacoInstance: typeof monaco) {
    monacoRef.current = monacoInstance
    ensureOpenplcThemes(monacoInstance)
  }

  useEffect(() => {
    const monacoInstance = monacoRef.current
    if (!monacoInstance) return
    applyThemeNow(monacoInstance, shouldUseDarkMode)
  }, [shouldUseDarkMode])

  // -----------------------------------------------------------------------
  // Editor mount
  // -----------------------------------------------------------------------

  function handleEditorDidMount(
    editorInstance: null | monaco.editor.IStandaloneCodeEditor,
    monacoInstance: null | typeof monaco,
  ) {
    editorRef.current = editorInstance
    monacoRef.current = monacoInstance
    setEditorMounted(true)

    if (!editorInstance || !monacoInstance) return

    // Sync cached Monaco model with the store value.
    const model = editorInstance.getModel()
    if (model) {
      const storePou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === name)
      const storeBodyValue = typeof storePou?.body.value === 'string' ? storePou.body.value : ''
      if (model.getValue() !== storeBodyValue) {
        isSyncingModelRef.current = true
        model.setValue(storeBodyValue)
        isSyncingModelRef.current = false
      }
    }

    focusDisposables.current.onFocus?.dispose()
    focusDisposables.current.onBlur?.dispose()

    focusDisposables.current.onFocus = editorInstance.onDidFocusEditorText(() => {
      openPLCStoreBase.getState().editorActions.setMonacoFocused(true)
    })

    focusDisposables.current.onBlur = editorInstance.onDidBlurEditorText(() => {
      openPLCStoreBase.getState().editorActions.setMonacoFocused(false)
    })

    // Apply theme
    const isDark = openPLCStoreBase.getState().workspace.systemConfigs.shouldUseDarkMode
    if (!didApplyInitialTheme) {
      applyThemeNow(monacoInstance, isDark)
      didApplyInitialTheme = true
    } else {
      applyThemeNow(monacoInstance, isDark)
    }

    // Check for external file changes on mount (editor-only)
    if (capabilities.hasFileWatcher) {
      void (async () => {
        const isSaved = openPLCStoreBase.getState().fileActions.getSavedState({ name })
        if (!isSaved) return

        const currentPou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === name)
        if (!currentPou) return

        const currentProjectPath = openPLCStoreBase.getState().project.meta.path
        if (!currentProjectPath) return

        try {
          const actualExtension = getExtensionFromLanguage(language)
          const pouFolder = getFolderFromPouType(currentPou.pouType)
          const fullPath = `${currentProjectPath}/pous/${pouFolder}/${name}${actualExtension}`

          const result = await projectPort.readFileContent(fullPath)

          if (result.success && result.content) {
            const parsedPou =
              language === 'st' || language === 'il'
                ? parseTextualPouFromString(result.content, language, currentPou.pouType)
                : parseHybridPouFromString(result.content, language, currentPou.pouType)
            const newBodyValue = typeof parsedPou.body.value === 'string' ? parsedPou.body.value : ''

            const currentBodyValue = typeof currentPou.body.value === 'string' ? currentPou.body.value : ''
            if (newBodyValue !== currentBodyValue) {
              setLocalText(newBodyValue)
              updatePou({ name, content: { language, value: newBodyValue } })
            }
          }
        } catch (err) {
          console.error('[Monaco] Failed to check for external changes on mount:', err)
        }
      })()
    }

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

    // Python LSP (gated)
    if (capabilities.hasPythonLSP && language === 'python' && pou) {
      injectPythonTemplateIfNeeded(editorInstance, pou, name)
      initPythonLSP(monacoInstance)
        .then(() => setupPythonLSPForEditor(editorInstance))
        .catch((err: unknown) => console.warn('[Python LSP]', err instanceof Error ? err.message : err))
    } else if (language === 'python' && pou) {
      // Web: no LSP but still inject template
      injectPythonTemplateIfNeeded(editorInstance, pou, name)
    }

    if (language === 'cpp' && pou) {
      injectCppTemplateIfNeeded(editorInstance, pou, name)
    }

    // Keyboard shortcuts: Ctrl+S (save active file), Ctrl+Shift+S (save entire project)
    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      if (openPLCStoreBase.getState().workspace.editingState !== 'save-request') {
        void executeSaveActiveFile(projectPort)
      }
    })

    editorInstance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyS,
      () => {
        if (openPLCStoreBase.getState().workspace.editingState !== 'save-request') {
          void executeSaveProject(projectPort)
        }
      },
    )

    // AI Chat toggle (gated)
    if (capabilities.hasAIAssistant) {
      editorInstance.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyL,
        () => {
          const aiActions = openPLCStoreBase.getState().aiActions
          aiActions.toggleChat()
        },
      )
    }

    // Manual trigger suggest
    const handleKeyUp = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey
      if (ctrlOrCmd && e.code === 'Space') {
        e.preventDefault()
        editorInstance.trigger('manual', 'editor.action.triggerSuggest', {})
      }
    }
    window.addEventListener('keyup', handleKeyUp)

    // AI chat insert-at-cursor event (gated)
    const handleInsertAtCursor = capabilities.hasAIAssistant
      ? (e: Event) => {
          const code = (e as CustomEvent<string>).detail
          if (!code) return
          const currentEditorName = openPLCStoreBase.getState().editor.meta.name
          if (currentEditorName !== name) return
          const position = editorInstance.getPosition()
          if (!position) return
          editorInstance.executeEdits('ai-chat-insert', [
            {
              range: new monacoInstance.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
              text: code,
            },
          ])
        }
      : null

    if (handleInsertAtCursor) {
      window.addEventListener('ai-insert-at-cursor', handleInsertAtCursor)
    }

    // Listen for AI tool updates — enter diff review mode
    const handlePouUpdated = (e: Event) => {
      const {
        pouName: targetPou,
        body,
        oldBody,
      } = (e as CustomEvent<{ pouName: string; body: string; oldBody?: string }>).detail
      if (targetPou !== name) return

      // If no old body provided (backward compat), apply directly
      if (oldBody === undefined) {
        const model = editorInstance.getModel()
        if (model && model.getValue() !== body) {
          isSyncingModelRef.current = true
          const fullRange = model.getFullModelRange()
          editorInstance.executeEdits('ai-tool-update', [{ range: fullRange, text: body }])
          isSyncingModelRef.current = false
        }
        setLocalText(body)
        return
      }

      // Update the editor model with the new body first (so decorations render on actual lines)
      const model = editorInstance.getModel()
      if (model && model.getValue() !== body) {
        isSyncingModelRef.current = true
        const fullRange = model.getFullModelRange()
        editorInstance.executeEdits('ai-tool-update', [{ range: fullRange, text: body }])
        isSyncingModelRef.current = false
      }
      setLocalText(body)

      // Compute diff hunks
      const hunks = computeHunks(oldBody, body)
      if (hunks.length === 0) return // No changes

      // All hunks accepted by default
      const acceptedIds = new Set(hunks.map((h) => h.id))
      setDiffReview({ active: true, oldBody, newBody: body, hunks, acceptedHunks: acceptedIds })
    }
    window.addEventListener('ai-pou-updated', handlePouUpdated)

    // Listen for global accept/reject from chat panel
    const handleAcceptAllHunks = (e: Event) => {
      const { pouName: targetPou } = (e as CustomEvent<{ pouName: string }>).detail
      if (targetPou !== name) return
      setDiffReview(null)
    }
    window.addEventListener('ai-accept-all-hunks', handleAcceptAllHunks)

    const handleRejectAllHunks = (e: Event) => {
      const { pouName: targetPou } = (e as CustomEvent<{ pouName: string }>).detail
      if (targetPou !== name) return
      setDiffReview(null)
    }
    window.addEventListener('ai-reject-all-hunks', handleRejectAllHunks)

    editorInstance.onDidDispose(() => {
      window.removeEventListener('keyup', handleKeyUp)
      if (handleInsertAtCursor) {
        window.removeEventListener('ai-insert-at-cursor', handleInsertAtCursor)
      }
      window.removeEventListener('ai-pou-updated', handlePouUpdated)
      window.removeEventListener('ai-accept-all-hunks', handleAcceptAllHunks)
      window.removeEventListener('ai-reject-all-hunks', handleRejectAllHunks)
    })

    editorInstance.focus()
  }

  // -----------------------------------------------------------------------
  // Template injection
  // -----------------------------------------------------------------------

  function injectPythonTemplateIfNeeded(
    editorInst: monaco.editor.IStandaloneCodeEditor,
    pouObj: PLCPou,
    pouName: string,
  ) {
    const editorModel = editorInst.getModel()
    if (!editorModel) return

    const stateValue = pouObj.body.value as string
    const stateIsEmpty = !stateValue || stateValue.trim() === ''
    const alreadyInjected = templatesInjected.has(pouName)

    if (stateIsEmpty && !alreadyInjected) {
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

      editorInst.setValue(pythonTemplate)
      handleWriteInPou(pythonTemplate)

      const lineCount = editorModel.getLineCount()
      const lastLineContent = editorModel.getLineContent(lineCount)
      editorInst.setPosition({ lineNumber: lineCount, column: lastLineContent.length + 1 })

      setTemplatesInjected((prev) => new Set(prev).add(pouName))
    }
  }

  function injectCppTemplateIfNeeded(editorInst: monaco.editor.IStandaloneCodeEditor, pouObj: PLCPou, pouName: string) {
    const editorModel = editorInst.getModel()
    if (!editorModel) return

    const stateValue = pouObj.body.value as string
    const stateIsEmpty = !stateValue || stateValue.trim() === ''
    const alreadyInjected = templatesInjected.has(pouName)

    if (stateIsEmpty && !alreadyInjected) {
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

      editorInst.setValue(cppTemplate)
      handleWriteInPou(cppTemplate)

      const lineCount = editorModel.getLineCount()
      const lastLineContent = editorModel.getLineContent(lineCount)
      editorInst.setPosition({ lineNumber: lineCount, column: lastLineContent.length + 1 })

      setTemplatesInjected((prev) => new Set(prev).add(pouName))
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function moveToMatch(
    editorInst: monaco.editor.IStandaloneCodeEditor | null,
    query: string,
    caseSensitive: boolean,
    isRegex: boolean,
  ) {
    if (!editorInst || !monacoRef.current || !query) return

    const model = editorInst.getModel()
    if (!model) return

    const matches = model.findMatches(query, true, isRegex, caseSensitive, null, true)

    if (matches && matches.length > 0) {
      const firstMatchRange = matches[0].range
      editorInst.setSelection(firstMatchRange)
      editorInst.revealRangeInCenter(firstMatchRange)
    }
  }

  function handleWriteInPou(value: string | undefined) {
    if (value === undefined) return

    setLocalText(value)
    if (isSyncingModelRef.current) return
    // During debug the editor is read-only — any onChange event is a false positive
    // from Monaco's internal state management (e.g. model sync), not a user edit.
    if (isDebuggerVisible) return
    handleFileAndWorkspaceSavedState(name)
    updatePou({ name, content: { language, value } })
  }

  // -----------------------------------------------------------------------
  // Editor options
  // -----------------------------------------------------------------------

  const monacoEditorUserOptions: monacoEditorOptionsType = {
    minimap: { enabled: false },
    dropIntoEditor: { enabled: true },
    readOnly: isDebuggerVisible,
    quickSuggestions: capabilities.hasAIAssistant ? false : undefined,
    ...(capabilities.hasAIAssistant && {
      inlineSuggest: {
        enabled: true,
        suppressSuggestions: true,
      },
    }),
  }

  // -----------------------------------------------------------------------
  // Drag-and-drop
  // -----------------------------------------------------------------------

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
      pouToAppend = libraryToUse?.pous.find((p) => p.name === pouName)
    } else {
      const libraries = sliceLibraries.user
      const libraryToUse = libraries.find((library) => library.name === libraryName)
      const foundPou = pous.find((p) => p.name === libraryToUse?.name)
      if (!foundPou) return
      pouToAppend = {
        name: foundPou.name,
        type: foundPou.pouType,
        variables: (foundPou.interface?.variables ?? []).map((variable) => ({
          name: variable.name,
          class: variable.class,
          type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
        })),
        documentation: foundPou.documentation,
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
    let varName = baseName
    let index = 1

    while (existingNames.includes(varName)) {
      varName = `${baseName}_${index}`
      index++
    }

    return varName
  }

  const handleRenamePou = () => {
    if (!contentToDrop || !editorRef.current) return

    // Push snapshot for undo support
    const currentPou = pous.find((p) => p.name === editor.meta.name)
    if (!currentPou) return

    const currentVars = currentPou.interface?.variables ?? []
    pushToHistory(editor.meta.name, {
      variables: currentVars,
      body: currentPou.body.value,
      globalVariables: globalVariables,
    })

    const existingNames = currentVars.map((variable) => variable.name)
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

  // -----------------------------------------------------------------------
  // Save editor view state on tab switch
  // -----------------------------------------------------------------------

  useEffect(() => {
    const unsub = openPLCStoreBase.subscribe(
      (state) => state.editor.meta.name,
      (nextName, prevEditorName) => {
        if (nextName === prevEditorName || !editorRef.current) return

        const ed = editorRef.current
        const model = ed.getModel()
        const pos = ed.getPosition()
        const offset = pos && model?.getOffsetAt(pos)

        const cursorPosition = pos && offset ? { lineNumber: pos.lineNumber, column: pos.column, offset } : undefined

        const scrollPosition = {
          top: ed.getScrollTop(),
          left: ed.getScrollLeft(),
        }

        saveEditorViewState({ prevEditorName, cursorPosition, scrollPosition })
      },
    )

    return () => unsub()
  }, [])

  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      <div id='editor drop handler' className='oplc-monaco-wrapper relative h-full w-full' onDrop={handleDrop}>
        <PrimitiveEditor
          key={capabilities.hasLocalFilesystem ? undefined : path}
          options={monacoEditorUserOptions}
          height='100%'
          width='100%'
          path={uniqueMonacoPath}
          language={language}
          defaultValue={''}
          value={localText}
          beforeMount={handleEditorBeforeMount}
          onMount={handleEditorDidMount}
          onChange={handleWriteInPou}
          theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
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
