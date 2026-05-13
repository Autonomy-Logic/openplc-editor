/**
 * Library Manifest editor — Monaco-wrapped `library.json` at the
 * project root.  Only ever rendered when the project is a library
 * (the workspace screen routes this editor model only when
 * `meta.type === 'plc-library'`).
 *
 * Architecturally identical to the textual POU editors (ST / IL /
 * Python / C++): one in-store value, one update action, one
 * `handleFileAndWorkspaceSavedState` call per Monaco edit, one
 * iterator yield in the save pipeline.  The manifest just happens
 * to be JSON instead of an IEC language, and its file lives at
 * `<projectPath>/library.json` instead of `pous/<type>/<name>.<ext>`.
 *
 *   - Content source: `project.data.libraryManifest` (set on
 *     project open by `parseProjectFiles`, seeded on create by
 *     `buildProjectFileContent`).
 *   - Edits: `projectActions.updateLibraryManifest(value)` +
 *     `handleFileAndWorkspaceSavedState(LIBRARY_MANIFEST_TAB_NAME)`.
 *   - Save: standard `executeSaveProject` pipeline serialises the
 *     in-store value to `library.json` via the `'library-manifest'`
 *     spec category — no dedicated save path.
 *   - Dirty: file-slice `cleanState` snapshots the in-store value
 *     when the tab mounts; the existing
 *     `handleFileAndWorkspaceSavedState` helper flips the file's
 *     `saved` flag and bubbles to `workspace.editingState`.
 *
 * What's intentionally not here:
 *
 *   - Manifest schema validation.  The build pipeline rejects
 *     malformed manifests at build time with clear errors.
 *   - Tab close affordance.  The user can close + re-open from the
 *     project tree; persistence + the store-driven model mean the
 *     editor re-mounts with the same content.
 */

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@root/frontend/store'
import { LIBRARY_MANIFEST_TAB_NAME } from '@root/frontend/store/slices/tabs/utils'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef } from 'react'

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

  // Register the file-slice entry on mount with `cleanState`
  // snapshotting the current in-store content.  Mirrors the POU
  // editor pattern: the file slice owns the dirty-vs-clean compare,
  // the manifest tab is just one more entry in that registry.
  // `addFile` is a no-op when the entry already exists, so a
  // re-mount keeps the prior cleanState — the user's in-flight
  // edits survive a tab switch.
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

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return
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
        value={manifestContent}
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
        }}
      />
    </div>
  )
}

export { LibraryManifestEditor }
