/**
 * Library Manifest editor — Monaco-wrapped `library.json` at the
 * project root.  Only ever rendered when the project is a library
 * (the workspace screen routes this editor model only when
 * `meta.type === 'plc-library'`).
 *
 * Responsibilities:
 *
 *   - Read `library.json` from disk on mount (via `projectPort`).
 *   - Render its content in Monaco with JSON syntax + diagnostics.
 *   - File-slice integration: registers a `'library-manifest'`
 *     entry on mount with `cleanState` snapshotting the on-disk
 *     content.  Edits compare against `cleanState` to flip the tab's
 *     dirty flag.  Ctrl+S / File → Save and the save-changes-on-
 *     close modal both route through this entry exactly the same
 *     way they do for POU tabs and library-manager / vendor-screen
 *     tabs (same `cleanState` pattern, surgical save in Phase 5).
 *
 * What's intentionally not here:
 *
 *   - Manifest schema validation.  Phase 6's build pipeline rejects
 *     malformed manifests at build time with clear errors; inline
 *     validation in Monaco would duplicate that boundary and bind
 *     the editor to strucpp's manifest type before we want to.
 *     Future polish.
 *
 *   - Tab close affordance.  The user can close the tab and re-open
 *     it from the project tree — same shape every other tab type
 *     uses.  Persistence on disk means closing the tab doesn't
 *     lose content.
 */

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { useOpenPLCStore } from '@root/frontend/store'
import { LIBRARY_MANIFEST_TAB_NAME } from '@root/frontend/store/slices/tabs/utils'
import { useProject } from '@root/middleware/shared/providers'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, useState } from 'react'

const LibraryManifestEditor = () => {
  const projectPort = useProject()
  const projectPath = useOpenPLCStore((s) => s.project.meta.path)
  const addFile = useOpenPLCStore((s) => s.fileActions.addFile)
  const updateFile = useOpenPLCStore((s) => s.fileActions.updateFile)
  const getFile = useOpenPLCStore((s) => s.fileActions.getFile)
  // The save flow (`executeSaveFile`) reads the live manifest buffer
  // from this store field so the surgical save doesn't have to reach
  // into the editor's React state.  Same pattern POU body / vendor-
  // screen data use to round-trip through the store.
  const setBuffer = useOpenPLCStore((s) => s.workspaceActions.setLibraryManifestBuffer)

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [content, setContent] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const manifestPath = projectPath ? `${projectPath}/library.json` : null

  /**
   * Load the manifest from disk on mount + on project change.  Same
   * cleanState bootstrap pattern the library-manager and vendor-
   * screen tabs use: the freshly-read content seeds the
   * file-slice's `cleanState`, then subsequent edits dirty the tab
   * by diverging from it.
   */
  useEffect(() => {
    if (!manifestPath) return
    let cancelled = false
    void (async () => {
      try {
        const res = await projectPort.readFileContent(manifestPath)
        if (cancelled) return
        if (!res.success || res.content === undefined) {
          setLoadError(res.error ?? 'Could not read library.json')
          return
        }
        setContent(res.content)
        setLoaded(true)
        // Register the file-slice entry.  `addFile` is a no-op when
        // an entry already exists for the same name (re-mounting the
        // tab keeps the prior cleanState — the user's in-flight edits
        // survive a tab switch).
        addFile({
          name: LIBRARY_MANIFEST_TAB_NAME,
          type: 'library-manifest',
          filePath: manifestPath,
          cleanState: res.content,
        })
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Intentionally only re-runs when the project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestPath])

  /**
   * Dirty-tracking effect: compare the live editor content against
   * `cleanState` and flip the file-slice `saved` flag.  Mirrors the
   * pattern in `LibraryManagerEditor` and `VendorScreenEditor`.
   */
  useEffect(() => {
    if (!loaded) return
    // Publish the live content to the store so the save flow can
    // read it via a synchronous selector — surgical save in
    // `executeSaveFile` doesn't have access to this component's
    // React state.
    setBuffer(content)

    const file = getFile({ name: LIBRARY_MANIFEST_TAB_NAME }).file
    if (!file) return
    const clean = typeof file.cleanState === 'string' ? file.cleanState : content
    const isClean = content === clean
    if (file.saved !== isClean) {
      updateFile({ name: LIBRARY_MANIFEST_TAB_NAME, saved: isClean })
    }
  }, [content, loaded, getFile, updateFile, setBuffer])

  // Clear the store buffer when the tab unmounts so a stale value
  // doesn't survive a project close + library reopen cycle.
  useEffect(() => {
    return () => {
      setBuffer(null)
    }
  }, [setBuffer])

  const handleChange = useCallback((value: string | undefined) => {
    setContent(value ?? '')
  }, [])

  const handleEditorMount = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor) => {
      editorRef.current = editor
    },
    [],
  )

  if (loadError) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-red-600'>
        Failed to load library.json: {loadError}
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
        Loading library manifest...
      </div>
    )
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <PrimitiveEditor
        height='100%'
        language='json'
        value={content}
        onChange={handleChange}
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
