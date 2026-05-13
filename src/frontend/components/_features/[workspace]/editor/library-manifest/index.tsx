/**
 * Library Manifest editor — Monaco-wrapped `library.json` at the
 * project root.  Only ever rendered when the project is a library
 * (the workspace screen routes this editor model only when
 * `meta.type === 'plc-library'`).
 *
 * Architecturally identical to the textual POU editors (ST / IL /
 * Python / C++) — see `editor/monaco/index.tsx`'s `handleWriteInPou`
 * and the surrounding model-sync effect.  Same three pieces:
 *
 *   - **Local state for the Monaco model value** (`localText`).
 *     Monaco's `value` prop is driven from this, NOT from the store
 *     directly — re-rendering Monaco with a new `value` prop while
 *     the editor is being disposed has been observed to leave
 *     internal services (WordHighlighter etc.) with pending
 *     Delayer tasks that throw "Canceled" on teardown.
 *   - **Store → local sync via `model.setValue()`** wrapped in
 *     `isSyncingModelRef.current = true` so the resulting
 *     `onChange` doesn't get mis-classified as a user edit and
 *     re-mark the file dirty.  Drives the "Don't save" revert and
 *     any other external store update (e.g. a future project
 *     reload).
 *   - **Local → store sync via `onChange`**, gated on
 *     `isSyncingModelRef` so programmatic updates round-trip
 *     cleanly.  On every user edit:
 *     `handleFileAndWorkspaceSavedState(LIBRARY_MANIFEST_TAB_NAME)`
 *     + `projectActions.updateLibraryManifest(value)` — exactly
 *     the same shape as `handleWriteInPou`'s
 *     `handleFileAndWorkspaceSavedState(name)` + `updatePou(...)`.
 *
 * Save flow / dirty tracking / "Don't save" revert are entirely
 * shared with every other tab: the file-slice entry, the
 * `iterateProjectFiles` yield, and the `reloadLibraryManifestFromCleanState`
 * revert all source from `project.data.libraryManifest` exactly
 * like POU tabs source from `project.data.pous[i].body.value`.
 */

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@root/frontend/store'
import { LIBRARY_MANIFEST_TAB_NAME } from '@root/frontend/store/slices/tabs/utils'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, useState } from 'react'

import { applyThemeNow, ensureOpenplcThemes } from '../monaco/theme-utils'

const LibraryManifestEditor = () => {
  const manifestContent = useOpenPLCStore((s) => s.project.data.libraryManifest ?? '')
  const shouldUseDarkMode = useOpenPLCStore((s) => s.workspace.systemConfigs.shouldUseDarkMode)
  const updateLibraryManifest = useOpenPLCStore((s) => s.projectActions.updateLibraryManifest)
  const handleFileAndWorkspaceSavedState = useOpenPLCStore(
    (s) => s.sharedWorkspaceActions.handleFileAndWorkspaceSavedState,
  )
  const addFile = useOpenPLCStore((s) => s.fileActions.addFile)

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monaco | null>(null)
  /** True while we're imperatively setting the model value from the
   *  store (e.g. "Don't save" revert).  Suppresses the resulting
   *  onChange from being treated as a user edit. */
  const isSyncingModelRef = useRef(false)
  const [localText, setLocalText] = useState(manifestContent)

  // Register the file-slice entry on mount with `cleanState`
  // snapshotting the current in-store content.  `addFile` is a
  // no-op when the entry already exists, so a re-mount keeps the
  // prior cleanState — in-flight edits survive a tab switch.
  useEffect(() => {
    addFile({
      name: LIBRARY_MANIFEST_TAB_NAME,
      type: 'library-manifest',
      filePath: 'library.json',
      cleanState: manifestContent,
    })
    // Intentionally only on mount — depending on `manifestContent`
    // would reset cleanState on every keystroke, defeating dirty
    // tracking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync the Monaco model when the store value changes from outside
  // the editor (the "Don't save" revert is the main case today; a
  // future project reload would also hit this path).  Imperative
  // `model.setValue` + `isSyncingModelRef` guard mirror the POU
  // editor — see `editor/monaco/index.tsx` around `handleEditorDidMount`.
  useEffect(() => {
    const editorInstance = editorRef.current
    if (!editorInstance) {
      // Editor not yet mounted; the `value` prop fallback +
      // `localText` initial state cover the first paint.
      setLocalText(manifestContent)
      return
    }
    const model = editorInstance.getModel()
    if (!model) return
    if (model.getValue() === manifestContent) return
    isSyncingModelRef.current = true
    model.setValue(manifestContent)
    isSyncingModelRef.current = false
    setLocalText(manifestContent)
  }, [manifestContent])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return
      setLocalText(value)
      // Skip the store update when the change came from our own
      // `model.setValue` above (a store-driven sync, not a user
      // edit).  Without this guard, the revert path would
      // re-flag the file dirty immediately after restoring it.
      if (isSyncingModelRef.current) return
      // Same two-step every textual POU editor uses — see
      // `handleWriteInPou` in `editor/monaco/index.tsx`:
      //   1. Mark file dirty + bubble to workspace.editingState.
      //   2. Update the in-store value.
      handleFileAndWorkspaceSavedState(LIBRARY_MANIFEST_TAB_NAME)
      updateLibraryManifest(value)
    },
    [handleFileAndWorkspaceSavedState, updateLibraryManifest],
  )

  // Register the OpenPLC light/dark themes on the same Monaco
  // instance the rest of the app uses.  `ensureOpenplcThemes` is
  // idempotent — a second mount is a no-op.
  const handleBeforeMount = useCallback((monacoInstance: typeof monaco) => {
    monacoRef.current = monacoInstance
    ensureOpenplcThemes(monacoInstance)
  }, [])

  const handleEditorMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
  }, [])

  // Re-apply the OpenPLC theme when the app's dark-mode toggle
  // flips.  Global on the Monaco namespace, so one call updates
  // every model — including this manifest tab.
  useEffect(() => {
    const monacoInstance = monacoRef.current
    if (!monacoInstance) return
    applyThemeNow(monacoInstance, shouldUseDarkMode)
  }, [shouldUseDarkMode])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <PrimitiveEditor
        height='100%'
        language='json'
        theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
        value={localText}
        onChange={handleChange}
        beforeMount={handleBeforeMount}
        onMount={handleEditorMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          tabSize: 2,
          formatOnPaste: true,
          formatOnType: true,
          renderWhitespace: 'selection',
          scrollBeyondLastLine: false,
          // Disable the word-occurrences highlighter.  Its debounced
          // Delayer has been observed to throw "Canceled" on editor
          // teardown (e.g. closing the tab right after a "Don't
          // save" revert).  The manifest is JSON — there's nothing
          // meaningful to highlight occurrences of anyway.
          occurrencesHighlight: 'off',
        }}
      />
    </div>
  )
}

export { LibraryManifestEditor }
