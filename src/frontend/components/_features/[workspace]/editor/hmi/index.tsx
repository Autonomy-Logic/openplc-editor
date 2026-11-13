/**
 * HMI screens and widget blocks, edited as ST until the designer opens them, and the HMI Settings tab. The code
 * editor follows the library manifest editor: Monaco's model is driven from local state, store changes reach it
 * through `model.setValue` under a guard, and user edits mark the file unsaved and update the store.
 */
import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@root/frontend/store'
import type * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, useState } from 'react'

import { applyThemeNow, ensureOpenplcThemes } from '../monaco/theme-utils'

type HmiCodeEditorProps = {
  name: string
  kind: 'screen' | 'widget'
}

const HmiCodeEditor = ({ name, kind }: HmiCodeEditorProps) => {
  const source = useOpenPLCStore(
    (s) =>
      (kind === 'screen' ? s.project.data.hmi?.screens : s.project.data.hmi?.widgets)?.find((f) => f.name === name)
        ?.source ?? '',
  )
  const shouldUseDarkMode = useOpenPLCStore((s) => s.workspace.systemConfigs.shouldUseDarkMode)
  const isDebuggerVisible = useOpenPLCStore((s) => s.workspace.isDebuggerVisible)
  const updateHmiSource = useOpenPLCStore((s) => s.projectActions.updateHmiSource)
  const handleFileAndWorkspaceSavedState = useOpenPLCStore(
    (s) => s.sharedWorkspaceActions.handleFileAndWorkspaceSavedState,
  )

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
      handleFileAndWorkspaceSavedState(name)
      updateHmiSource(kind, name, value)
    },
    [handleFileAndWorkspaceSavedState, updateHmiSource, kind, name],
  )

  const handleBeforeMount = useCallback((monacoInstance: typeof monaco) => {
    monacoRef.current = monacoInstance
    ensureOpenplcThemes(monacoInstance)
  }, [])

  const handleEditorMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
  }, [])

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
          // Its debounced highlighter can throw on teardown; nothing here needs it.
          occurrencesHighlight: 'off',
        }}
      />
    </div>
  )
}

/** HMI Settings; its editor arrives with the designer. */
const HmiSettingsEditor = () => (
  <div
    className='flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center'
    data-testid='hmi-settings-placeholder'
  >
    <p className='font-caption text-sm font-medium text-neutral-950 dark:text-white'>HMI Settings</p>
    <p className='max-w-md font-caption text-xs text-neutral-600 dark:text-neutral-400'>
      The editor for the start screen, frame period, role grid, panel PIN and themes is coming. The settings are kept in
      hmi/settings.json and saved with the project.
    </p>
  </div>
)

export { HmiCodeEditor, HmiSettingsEditor }
