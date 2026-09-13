import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PLCPou } from '../../../../../../middleware/shared/ports/types'
import { useAI, useCapabilities, useEdgeAccountPort, useProject } from '../../../../../../middleware/shared/providers'
import { useDebugBoolValuesMap, useDebugNonBoolValuesMap } from '../../../../../hooks/use-debug-value'
import { registerAIInlineCompletions } from '../../../../../services/ai/inline-completions'
import { getCppMemberCompletions, projectTypeNamePredicate } from '../../../../../services/cpp-scope'
import { executeSaveActiveFile, executeSaveProject } from '../../../../../services/save-actions'
import { pouUri, splitExpression } from '../../../../../services/st-lsp'
import { openPLCStoreBase, useOpenPLCStore } from '../../../../../store'
import { applyAcceptedHunks, computeHunks } from '../../../../../utils/ai-diff-review'
import { memberChainBefore } from '../../../../../utils/cpp/member-chain'
import { getExtensionFromLanguage, getFolderFromPouType } from '../../../../../utils/PLC/pou-file-extensions'
import { parseHybridPouFromString, parseTextualPouFromString } from '../../../../../utils/PLC/pou-text-parser'
import { Modal, ModalContent, ModalTitle } from '../../../../_molecules/modal'
import { toast } from '../../../[app]/toast/use-toast'
import { renderDiffReview } from './ai-diff-review'
import { type AiLspCoexistenceController, installAiLspCoexistenceKeybindings } from './ai-lsp-coexistence'
import {
  arduinoApiCompletion,
  cppSignatureHelp,
  cppSnippetsCompletion,
  cppStandardLibraryCompletion,
  keywordsCompletion,
  libraryCompletion,
  tableGlobalVariablesCompletion,
  tableVariablesCompletion,
} from './completion'
import { parsePouToStText } from './drag-and-drop/st'
import { cleanupPythonLSP, initPythonLSP, setupPythonLSPForEditor, updatePythonLspContext } from './python-lsp'
import { applyThemeNow, ensureOpenplcThemes } from './theme-utils'

type monacoEditorProps = {
  path: string
  name: string
  language: 'il' | 'st' | 'python' | 'cpp'
  /** Whether this is the active (visible) tab; gates side effects so hidden editors don't do wasted work. */
  isActive?: boolean
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

let didApplyInitialTheme = false

const MonacoEditor = (props: monacoEditorProps): ReturnType<typeof PrimitiveEditor> => {
  const { language, path, name, isActive = true } = props
  const editorRef = useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const monacoRef = useRef<null | typeof monaco>(null)
  const focusDisposables = useRef<{ onFocus?: monaco.IDisposable; onBlur?: monaco.IDisposable }>({})
  const coexistenceRef = useRef<AiLspCoexistenceController | null>(null)
  const [editorMounted, setEditorMounted] = useState(false)
  const [modelVersion, setModelVersion] = useState(0)
  const isSyncingModelRef = useRef(false)

  const capabilities = useCapabilities()
  const aiPort = useAI()
  const edgeAccount = useEdgeAccountPort()
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
        dataTypes,
        configurations: {
          resource: { globalVariables },
        },
      },
    },
    deviceDefinitions: {
      configuration: { deviceBoard },
    },
    libraries: sliceLibraries,
    projectActions: { updatePou, createVariable },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
    snapshotActions: { pushToHistory },
    ai: { pendingDiffs },
    aiActions: { updatePendingDiff, updatePendingDiffAcceptedHunks, clearPendingDiff },
  } = useOpenPLCStore()
  const debugBoolValues = useDebugBoolValuesMap()
  const debugNonBoolValues = useDebugNonBoolValuesMap()

  // Create a unique Monaco path for editor (prevents model caching across projects)
  const uniqueMonacoPath = capabilities.hasLocalFilesystem && projectPath ? `${projectPath}${path}` : path

  // ST POUs must use the STruC++ LSP's document URI (`inmemory://pou/<name>.st`), or
  // completion/hover/definition queries arrive with a URI the worker doesn't know.
  const editorModelPath = language === 'st' ? pouUri(name) : uniqueMonacoPath

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [contentToDrop, setContentToDrop] = useState<PouToText>()
  const [newName, setNewName] = useState<string>('')
  const [localText, setLocalText] = useState<string>(() => {
    const pou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === name)
    return typeof pou?.body.value === 'string' ? pou.body.value : ''
  })
  const watchedFilePathRef = useRef<string | null>(null)

  /** Bumped on every editor remount so the diff-review effect re-attaches to the fresh instance. */
  const [editorInstanceId, setEditorInstanceId] = useState(0)

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

  // editorInstanceId is a dep because <PrimitiveEditor key={path}> remounts on tab switch
  // (web build); its onMount fires after this effect first runs, so this re-runs once ready.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const entry = pendingDiffs[name]
    if (!entry || entry.hunks.length === 0) return () => {}

    const pendingSet = new Set(entry.acceptedHunks)
    const pendingHunks = entry.hunks.filter((h) => pendingSet.has(h.id))
    if (pendingHunks.length === 0) {
      clearPendingDiff(name)
      return () => {}
    }

    const handleKeepHunk = (hunkId: string) => {
      const state = openPLCStoreBase.getState()
      const current = state.ai.pendingDiffs[name]
      if (!current) return
      const nextAccepted = current.acceptedHunks.filter((id) => id !== hunkId)
      if (nextAccepted.length === 0) {
        clearPendingDiff(name)
        return
      }
      updatePendingDiffAcceptedHunks(name, nextAccepted)
    }

    const handleUndoHunk = (hunkId: string) => {
      const state = openPLCStoreBase.getState()
      const current = state.ai.pendingDiffs[name]
      if (!current) return

      // Rebuild body: every hunk except this one is treated as "kept" (new code),
      // the rejected one reverts to the old text.
      const keptIds = new Set(current.hunks.filter((h) => h.id !== hunkId).map((h) => h.id))
      const newBody = applyAcceptedHunks(current.oldBody, current.newBody, current.hunks, keptIds)

      const model = editor.getModel()
      if (model) {
        isSyncingModelRef.current = true
        const fullRange = model.getFullModelRange()
        editor.executeEdits('ai-diff-undo-hunk', [{ range: fullRange, text: newBody }])
        isSyncingModelRef.current = false
      }
      setLocalText(newBody)

      state.projectActions.updatePou({ name, content: { language, value: newBody } })

      const freshHunks = computeHunks(current.oldBody, newBody)
      if (freshHunks.length === 0) {
        clearPendingDiff(name)
        return
      }
      updatePendingDiff(name, {
        newBody,
        hunks: freshHunks,
        acceptedHunks: freshHunks.map((h) => h.id),
      })
    }

    const cleanup = renderDiffReview(editor, pendingHunks, handleKeepHunk, handleUndoHunk)
    return cleanup
  }, [
    pendingDiffs,
    name,
    language,
    editorInstanceId,
    clearPendingDiff,
    updatePendingDiff,
    updatePendingDiffAcceptedHunks,
  ])

  // Every multi-mounted MonacoEditor subscribes to `searchQuery`, but only the active tab reveals a match.
  useEffect(() => {
    if (!isActive) return
    if (editorRef.current && searchQuery) {
      moveToMatch(editorRef.current, searchQuery, sensitiveCase, regularExpression)
    }
  }, [searchQuery, sensitiveCase, regularExpression, isActive])

  // A hidden editor (`display: none`) captures stale (often zero) layout dimensions;
  // re-measure on every `isActive` flip to avoid a blank frame when it becomes visible.
  useEffect(() => {
    if (!isActive) return
    editorRef.current?.layout()
  }, [isActive])

  // Template injection when POU changes (for already mounted editors)
  useEffect(() => {
    if (language === 'python' && editorRef.current && pou) {
      injectPythonTemplateIfNeeded(editorRef.current, pou, name)
    }
    if (language === 'cpp' && editorRef.current && pou) {
      injectCppTemplateIfNeeded(editorRef.current, pou, name)
    }
  }, [pou])

  // Keeps the Python LSP's per-POU preamble (IEC variables -> Pyright globals) in sync with
  // the variables table, so Pyright doesn't flag names just added/renamed/removed.
  useEffect(() => {
    if (!capabilities.hasPythonLSP) return
    if (language !== 'python') return
    updatePythonLspContext(name, pouVariables, dataTypes)
  }, [capabilities.hasPythonLSP, language, name, pouVariables, dataTypes])

  useEffect(() => {
    return () => {
      setTemplatesInjected((prev) => {
        const newSet = new Set(prev)
        newSet.delete(name)
        return newSet
      })

      if (capabilities.hasPythonLSP && language === 'python') {
        cleanupPythonLSP(name)
      }
    }
  }, [name, language])

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

  // onMount only fires once, so onDidChangeModel detects later model switches (tab changes
  // with keepCurrentModel) and bumps modelVersion to trigger debugVarPositions recomputation.
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

  // Applies programmatic cursor jumps (e.g. a compile-error click) to an already-mounted
  // editor; the onMount path only covers the initial position. Safe from feedback loops —
  // the editor's own cursor moves are never written back to `editor.cursorPosition`.
  useEffect(() => {
    if (!editorMounted) return
    // Multi-mount: only the active tab should apply an incoming cursor jump to itself.
    if (!isActive) return
    const ed = editorRef.current
    const monacoInst = monacoRef.current
    const target = editor.cursorPosition
    if (!ed || !monacoInst || !target) return
    // Jumps targeting the variables panel belong to the variables-code-editor, not the body.
    if (target.target === 'variables') return
    const current = ed.getPosition()
    if (current && current.lineNumber === target.lineNumber && current.column === target.column) {
      return
    }
    // Select the whole line for visible feedback; lands at line start when strucpp gives no end-column.
    const model = ed.getModel()
    // Clamp to the model's valid line range — Monaco throws for a line outside it, e.g. a
    // freshly opened tab or a stale compiler line number for the current body.
    const safeLine = model ? Math.max(1, Math.min(model.getLineCount(), target.lineNumber)) : target.lineNumber
    if (model && safeLine !== target.lineNumber) {
      console.warn(
        `[monaco] cursor target line ${target.lineNumber} out of range (model has ${model.getLineCount()} lines); clamped to ${safeLine}`,
      )
    }
    const lineLength = model ? model.getLineMaxColumn(safeLine) : target.column
    const range = new monacoInst.Range(safeLine, 1, safeLine, lineLength)
    ed.setSelection(range)
    ed.revealRangeInCenter(range)
    ed.focus()
  }, [editor.cursorPosition, editorMounted, isActive])

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
    // Active-tab-only: avoids every hidden multi-mounted editor re-scanning and decorating on each poll.
    if (!isActive) return null
    if (!isDebuggerVisible || !editorRef.current || !monacoRef.current || (language !== 'st' && language !== 'il'))
      return null

    const model = editorRef.current.getModel()
    if (!model) return null

    // Guard against a stale model during tab switches, before @monaco-editor/react swaps it.
    const expectedUri = language === 'st' ? editorModelPath : monacoRef.current.Uri.file(uniqueMonacoPath).toString()
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
  }, [isActive, isDebuggerVisible, debugVarKeySet, language, name, fbInstanceContext, editorMounted, modelVersion])

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

  const keywordsSuggestions = useCallback((range: monaco.IRange) => {
    const allSuggestions = keywordsCompletion({
      range,
      language: 'il',
    }).suggestions
    const uniqueSuggestions = Array.from(new Map(allSuggestions.map((s) => [s.label, s])).values())
    const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
    return { suggestions: uniqueSuggestions, labels }
  }, [])

  // ST is intentionally absent here — strucpp's own LSP supersedes this. IL keeps this
  // hand-written completion because strucpp's LSP doesn't cover IL syntax.
  useEffect(() => {
    if (language !== 'il') return

    const disposable = monaco.languages.registerCompletionItemProvider('il', {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }
        const suggestions = [
          ...variablesSuggestions(range).suggestions,
          ...globalVariablesSuggestions(range).suggestions,
          ...librarySuggestions(range).suggestions,
          ...keywordsSuggestions(range).suggestions,
        ]
        const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
        return { suggestions: uniqueSuggestions }
      },
    })
    return () => disposable.dispose()
  }, [pouVariables, globalVariables, sliceLibraries, language])

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
      // `.` re-triggers the provider: without it Monaco only asks while a word
      // is being typed, so `motor.` alone would never open the member list.
      triggerCharacters: ['.'],
      provideCompletionItems: async (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        // After a `.` the only valid completions are that expression's members; offering
        // the standard library, snippets, and every in-scope name too would bury the answer.
        const lineBeforeCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })
        const { anchor } = splitExpression(memberChainBefore(lineBeforeCursor))
        if (anchor !== '') {
          // Read the store at query time instead of closing over pous/dataTypes/libraries:
          // those come from an unselected useOpenPLCStore() and change every keystroke, so
          // naming them as deps would re-register this provider (and signature-help) on every keystroke.
          const {
            project: {
              data: { pous: currentPous, dataTypes: currentDataTypes },
            },
            libraries: currentLibraries,
          } = openPLCStoreBase.getState()
          const members = await getCppMemberCompletions(
            name,
            anchor,
            projectTypeNamePredicate(currentPous, currentDataTypes, currentLibraries),
          )
          if (members.length > 0) {
            return {
              suggestions: members.map((member) => ({
                label: member.label,
                insertText: member.label,
                kind: monaco.languages.CompletionItemKind.Field,
                // The IEC name isn't always recoverable from the C++ spelling, so show it too.
                detail: member.type ? `${member.type} — ${member.iecName}` : member.iecName,
                range,
              })),
            }
          }
          // No members resolved (LSP not ready, or not a composite type): fall through
          // rather than assert an empty list, which would read as "nothing here".
        }

        const stdLibSuggestions = cppStandardLibraryCompletion({ range }).suggestions
        const snippetSuggestions = cppSnippetsCompletion({ range }).suggestions

        const boardInfo = openPLCStoreBase.getState().deviceAvailableOptions.availableBoards.get(deviceBoard)
        const offerArduinoApi = resolveTargetCapabilities(boardInfo).arduinoApiCompletions
        const arduinoSuggestions = offerArduinoApi ? arduinoApiCompletion({ range }).suggestions : []

        const code = model.getValue()
        const variableSuggestions = parseCppVariables(code, range)
        const tableVariableSuggestions = tableVariablesCompletion({ range, variables: pouVariables }).suggestions

        const suggestions: monaco.languages.CompletionItem[] = [
          ...stdLibSuggestions,
          ...snippetSuggestions,
          ...arduinoSuggestions,
          ...variableSuggestions,
          ...tableVariableSuggestions,
        ]

        return { suggestions }
      },
    })

    const signatureHelpDisposable = monaco.languages.registerSignatureHelpProvider('cpp', cppSignatureHelp)

    return () => {
      completionDisposable.dispose()
      signatureHelpDisposable.dispose()
    }
  }, [language, deviceBoard, pouVariables, name])

  const aiState = useOpenPLCStore().ai

  useEffect(() => {
    if (!capabilities.hasAIAssistant) return
    if (!aiState.isEnabled) return
    if (!aiState.hasConsented) return
    if (!aiState.preferences.inlineCompletionsEnabled) return

    // The provider is shared (frontend/services/ai) and reaches the platform only through the port.
    if (!aiPort) return

    const registration = registerAIInlineCompletions(aiPort, {
      monacoInstance: monaco,
      pouName: name,
      language,
      session: edgeAccount?.session,
    })

    return () => registration.dispose()
  }, [
    name,
    language,
    aiState.isEnabled,
    aiState.hasConsented,
    aiState.preferences.inlineCompletionsEnabled,
    capabilities.hasAIAssistant,
    aiPort,
    edgeAccount,
  ])

  function handleEditorBeforeMount(monacoInstance: typeof monaco) {
    monacoRef.current = monacoInstance
    ensureOpenplcThemes(monacoInstance)
  }

  useEffect(() => {
    const monacoInstance = monacoRef.current
    if (!monacoInstance) return
    applyThemeNow(monacoInstance, shouldUseDarkMode)
  }, [shouldUseDarkMode])

  function handleEditorDidMount(
    editorInstance: null | monaco.editor.IStandaloneCodeEditor,
    monacoInstance: null | typeof monaco,
  ) {
    editorRef.current = editorInstance
    monacoRef.current = monacoInstance
    setEditorMounted(true)
    // Bump on every mount (incl. remounts on tab switch) so diff-review re-attaches;
    // `editorMounted` only ever flips false->true once, so it won't re-trigger on remount.
    setEditorInstanceId((id) => id + 1)

    if (!editorInstance || !monacoInstance) return

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

    const isDark = openPLCStoreBase.getState().workspace.systemConfigs.shouldUseDarkMode
    if (!didApplyInitialTheme) {
      applyThemeNow(monacoInstance, isDark)
      didApplyInitialTheme = true
    } else {
      applyThemeNow(monacoInstance, isDark)
    }

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

    if (editor.cursorPosition && editor.cursorPosition.target !== 'variables') {
      // Applies a cursor jump that fired before mount completed; the reactive effect above
      // handles subsequent jumps. Same clamp as there.
      const monacoInst = monacoInstance
      const model = editorInstance.getModel()
      const targetLine = editor.cursorPosition.lineNumber
      const safeLine = model ? Math.max(1, Math.min(model.getLineCount(), targetLine)) : targetLine
      if (model && safeLine !== targetLine) {
        console.warn(
          `[monaco-mount] cursor target line ${targetLine} out of range (model has ${model.getLineCount()} lines); clamped to ${safeLine}`,
        )
      }
      const lineLength = model ? model.getLineMaxColumn(safeLine) : editor.cursorPosition.column
      const range = new monacoInst.Range(safeLine, 1, safeLine, lineLength)
      editorInstance.setSelection(range)
      editorInstance.revealRangeInCenter(range)
    }

    if (capabilities.hasPythonLSP && language === 'python' && pou) {
      injectPythonTemplateIfNeeded(editorInstance, pou, name)
      // Hands the LSP the POU's variables so Pyright doesn't flag every IEC I/O reference as undefined.
      initPythonLSP(monacoInstance)
        .then(() =>
          setupPythonLSPForEditor(editorInstance, {
            pouName: name,
            variables: pou.interface?.variables ?? [],
            dataTypes,
          }),
        )
        .catch((err: unknown) => console.warn('[Python LSP]', err instanceof Error ? err.message : err))
    } else if (language === 'python' && pou) {
      injectPythonTemplateIfNeeded(editorInstance, pou, name)
    }

    if (language === 'cpp' && pou) {
      injectCppTemplateIfNeeded(editorInstance, pou, name)
    }

    editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      if (openPLCStoreBase.getState().workspace.editingState !== 'save-request') {
        void executeSaveActiveFile(projectPort, capabilities)
      }
    })

    editorInstance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyS,
      () => {
        if (openPLCStoreBase.getState().workspace.editingState !== 'save-request') {
          void executeSaveProject(projectPort, capabilities)
        }
      },
    )

    if (capabilities.hasAIAssistant) {
      editorInstance.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyL,
        () => {
          const aiActions = openPLCStoreBase.getState().aiActions
          aiActions.toggleChat()
        },
      )
    }

    // Tab/Enter split so AI ghost text and the LSP dropdown can coexist; gated inert while AI
    // is off via a context key driven from `inlineCompletionsActive` (see the effect below).
    coexistenceRef.current = installAiLspCoexistenceKeybindings(editorInstance, monacoInstance)
    coexistenceRef.current.setActive(inlineCompletionsActive)

    const handleKeyUp = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey
      if (ctrlOrCmd && e.code === 'Space') {
        e.preventDefault()
        editorInstance.trigger('manual', 'editor.action.triggerSuggest', {})
      }
    }
    window.addEventListener('keyup', handleKeyUp)

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

    // Syncs this editor's model for the POU it displays; tool-executor writes pendingDiffs
    // even for unmounted POUs, and the render effect below attaches the overlay on switch-to.
    const handlePouUpdated = (e: Event) => {
      const { pouName: targetPou, body } = (e as CustomEvent<{ pouName: string; body: string; oldBody?: string }>)
        .detail
      if (targetPou !== name) return

      const model = editorInstance.getModel()
      if (model && model.getValue() !== body) {
        isSyncingModelRef.current = true
        const fullRange = model.getFullModelRange()
        editorInstance.executeEdits('ai-tool-update', [{ range: fullRange, text: body }])
        isSyncingModelRef.current = false
      }
      setLocalText(body)
    }
    window.addEventListener('ai-pou-updated', handlePouUpdated)

    // Fire on the chat panel's Keep/Undo All buttons; the panel also calls
    // clearAllPendingDiffs() to cover POUs that aren't currently active.
    const handleAcceptAllHunks = (e: Event) => {
      const { pouName: targetPou } = (e as CustomEvent<{ pouName: string }>).detail
      clearPendingDiff(targetPou)
    }
    window.addEventListener('ai-accept-all-hunks', handleAcceptAllHunks)

    const handleRejectAllHunks = (e: Event) => {
      const { pouName: targetPou } = (e as CustomEvent<{ pouName: string }>).detail
      clearPendingDiff(targetPou)
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
    // During debug the editor is read-only; any onChange here is a false positive from
    // Monaco's internal sync, not a user edit.
    if (isDebuggerVisible) return
    handleFileAndWorkspaceSavedState(name)
    updatePou({ name, content: { language, value } })
  }

  // AI ghost text and the LSP suggest widget coexist: Enter/arrows accept the LSP dropdown,
  // Tab commits the AI suggestion (see `installAiLspCoexistenceKeybindings`).
  const inlineCompletionsActive =
    capabilities.hasAIAssistant &&
    aiState.isEnabled &&
    aiState.hasConsented &&
    aiState.preferences.inlineCompletionsEnabled

  const monacoEditorUserOptions: monacoEditorOptionsType = {
    minimap: { enabled: false },
    dropIntoEditor: { enabled: true },
    readOnly: isDebuggerVisible,
    // Forces Monaco's classic textarea input instead of EditContext: Safari's support is
    // immature and its Tab keydown never reaches Monaco's keybinding service, silently
    // breaking Tab-accept of AI suggestions (also keeps `isInputDOMNode` recognising it).
    editContext: false,
    // Locks indentation to 4 spaces across all languages; without `detectIndentation: false`
    // Monaco can settle on 2 spaces for a Python body that mixes indent widths.
    tabSize: 4,
    insertSpaces: true,
    detectIndentation: false,
    // Let the LSP dropdown auto-open in both modes; the user accepts it with Enter/arrows.
    quickSuggestions: undefined,
    // Pinned for cross-platform parity with the variables-code-editor; Monaco's default
    // font size is platform-dependent (12 on macOS, 14 elsewhere).
    fontSize: 12,
    // Monaco's standalone themes default this to false, silently dropping the STruC++ LSP's
    // semantic-tokens response; forcing it on unblocks ST variable/type coloring.
    'semanticHighlighting.enabled': true,
    // The variables table above this panel clips hover/suggest overlays anchored on the first
    // few lines; `fixedOverflowWidgets` re-parents them to `document.body` so they escape it.
    fixedOverflowWidgets: true,
    ...(inlineCompletionsActive && {
      inlineSuggest: {
        enabled: true,
        // Keep the LSP dropdown visible alongside the AI ghost text — coexistence is the point.
        suppressSuggestions: false,
        // 'always' keeps the AI ghost visible even while the LSP dropdown auto-selects an
        // entry, which Monaco's default ('never') would hide right when Tab is reached for.
        // `experimental` isn't in the public type but is read at runtime, hence the cast.
        experimental: { showOnSuggestConflict: 'always' },
      } as monacoEditorOptionsType['inlineSuggest'],
    }),
  }

  // Keeps the coexistence Tab overrides in sync with AI state without remounting the editor;
  // `editorInstanceId` re-asserts it after a remount (belt-and-braces with the mount handler).
  useEffect(() => {
    coexistenceRef.current?.setActive(inlineCompletionsActive)
  }, [inlineCompletionsActive, editorInstanceId])

  // Monaco only auto-triggers inline completions on content change, so a late/superseded
  // result can be silently dropped with nothing re-requesting. Re-triggers once after 2s of
  // idle (AI on, no ghost text visible) so a settled cursor still eventually gets a suggestion.
  useEffect(() => {
    if (!inlineCompletionsActive) return
    const editor = editorRef.current
    if (!editor) return

    const IDLE_MS = 2000
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    const scheduleIdleRetrigger = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (!editor.hasTextFocus()) return
        const model = editor.getModel()
        if (!model || model.getValueLength() === 0) return
        // Skip if a ghost is already showing (avoid a redundant request).
        const dom = editor.getDomNode()
        if (dom?.querySelector('.ghost-text-decoration, .ghost-text, [class*="ghost-text"]')) return
        editor.trigger('openplc-ai-idle', 'editor.action.inlineSuggest.trigger', {})
      }, IDLE_MS)
    }

    const changeDisposable = editor.onDidChangeModelContent(scheduleIdleRetrigger)
    return () => {
      if (idleTimer) clearTimeout(idleTimer)
      changeDisposable.dispose()
    }
  }, [inlineCompletionsActive, editorInstanceId])

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

  return (
    <>
      {/* `nokey` opts out of xyflow's Space-pan listener, which doesn't see Monaco's div as an input. */}
      <div id='editor drop handler' className='oplc-monaco-wrapper nokey relative h-full w-full' onDrop={handleDrop}>
        <PrimitiveEditor
          key={capabilities.hasLocalFilesystem ? undefined : editorModelPath}
          options={monacoEditorUserOptions}
          height='100%'
          width='100%'
          path={editorModelPath}
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
