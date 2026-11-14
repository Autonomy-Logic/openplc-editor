/**
 * The ST view of an HMI screen or widget block. Monaco's model is driven from local state, store changes reach it
 * through `model.setValue` under a guard, and user edits go through the designer's history, merged while typing.
 */
import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@root/frontend/store'
import type * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, useState } from 'react'

import { applyThemeNow, ensureOpenplcThemes } from '../monaco/theme-utils'

type HmiCodeEditorProps = {
  name: string
  kind: 'screen' | 'widget'
  /** Requested with Ctrl/Cmd+Enter. */
  onPreview?: () => void
  /** A line to show and put the cursor on; `key` tells a repeated request for the same line apart. */
  reveal?: { line: number; key: number }
}

const HmiCodeEditor = ({ name, kind, onPreview, reveal }: HmiCodeEditorProps) => {
  const source = useOpenPLCStore(
    (s) =>
      (kind === 'screen' ? s.project.data.hmi?.screens : s.project.data.hmi?.widgets)?.find((f) => f.name === name)
        ?.source ?? '',
  )
  const shouldUseDarkMode = useOpenPLCStore((s) => s.workspace.systemConfigs.shouldUseDarkMode)
  const isDebuggerVisible = useOpenPLCStore((s) => s.workspace.isDebuggerVisible)
  const applySource = useOpenPLCStore((s) => s.hmiDesignerActions.applySource)
  const previewRef = useRef(onPreview)
  previewRef.current = onPreview

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monaco | null>(null)
  /** True while the model is set from the store, so the resulting change is not a user edit. */
  const isSyncingModelRef = useRef(false)
  const [localText, setLocalText] = useState(source)

  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (!model) {
      setLocalText(source)
      return
    }
    if (model.getValue() === source) return
    isSyncingModelRef.current = true
    model.setValue(source)
    isSyncingModelRef.current = false
    setLocalText(source)
  }, [source])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return
      setLocalText(value)
      if (isSyncingModelRef.current) return
      applySource(kind, name, value, { key: 'code', at: Date.now() })
    },
    [applySource, kind, name],
  )

  const handleBeforeMount = useCallback((monacoInstance: typeof monaco) => {
    monacoRef.current = monacoInstance
    ensureOpenplcThemes(monacoInstance)
  }, [])

  const [mounted, setMounted] = useState(false)
  const handleEditorMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
    const keys = monacoRef.current
    if (keys) editor.addCommand(keys.KeyMod.CtrlCmd | keys.KeyCode.Enter, () => previewRef.current?.())
    setMounted(true)
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!mounted || !editor || !reveal) return
    editor.revealLineInCenter(reveal.line)
    editor.setPosition({ lineNumber: reveal.line, column: 1 })
    editor.focus()
  }, [mounted, reveal])

  useEffect(() => {
    if (monacoRef.current) applyThemeNow(monacoRef.current, shouldUseDarkMode)
  }, [shouldUseDarkMode])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden' data-testid='hmi-code-editor'>
      <PrimitiveEditor
        height='100%'
        language='st'
        path={`hmi-${kind}-${name}`}
        theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
        value={localText}
        onChange={handleChange}
        beforeMount={handleBeforeMount}
        onMount={handleEditorMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          tabSize: 2,
          readOnly: isDebuggerVisible,
          renderWhitespace: 'selection',
          scrollBeyondLastLine: false,
          occurrencesHighlight: 'off',
        }}
      />
    </div>
  )
}

export { HmiCodeEditor }
