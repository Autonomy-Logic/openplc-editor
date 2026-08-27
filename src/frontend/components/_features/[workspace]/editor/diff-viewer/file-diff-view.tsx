/**
 * FileDiffView — single entry point for rendering a before/after diff of one
 * project file. Routes graphical POUs (.ld/.fbd) to the GraphicalDiffViewer
 * and everything else to Monaco's DiffEditor. Shared by the history page and
 * the source-control diff tab so both surfaces render diffs identically.
 */

import { DiffEditor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useEffect, useId, useRef } from 'react'

import { GraphicalDiffViewer, isGraphicalFile } from './graphical-diff-viewer'

export { isGraphicalFile }

/** Map a file path to the Monaco language id used for syntax highlighting. */
export function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'json':
      return 'json'
    case 'st':
    case 'il':
    case 'sfc':
      return 'st'
    case 'py':
      return 'python'
    case 'c':
      return 'c'
    case 'cpp':
      return 'cpp'
    default:
      return 'plaintext'
  }
}

/**
 * For graphical files (.ld/.fbd) shown in the textual diff, the embedded JSON
 * flow blob is noise — collapse it to a placeholder so the textual diff stays
 * focused on the variable declarations. Non-graphical files pass through
 * untouched. (Graphical files normally route to GraphicalDiffViewer, but this
 * keeps the helper safe if it is ever used on the textual side.)
 */
export function formatContentForDisplay(path: string, content: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext !== 'ld' && ext !== 'fbd') return content

  const endMatch = content.match(/\b(END_PROGRAM|END_FUNCTION_BLOCK|END_FUNCTION)\b/i)
  if (!endMatch || endMatch.index === undefined) return content

  const endKeyword = endMatch[0]
  const beforeEnd = content.slice(0, endMatch.index)

  const endVarIdx = beforeEnd.lastIndexOf('END_VAR')
  if (endVarIdx === -1) return content

  const declaration = beforeEnd.slice(0, endVarIdx + 'END_VAR'.length)
  return `${declaration}\n\n(* ${ext.toUpperCase()} graphical data omitted *)\n\n${endKeyword}`
}

type FileDiffViewProps = {
  filePath: string
  /** Original (e.g. HEAD / previous-commit) content. Empty string for added files. */
  original: string
  /** Current (e.g. working-tree / commit) content. Empty string for deleted files. */
  current: string
  isDark: boolean
}

/**
 * Tears the Monaco diff editor down in the order Monaco requires.
 *
 * `@monaco-editor/react` (4.7) does it the other way round: its cleanup disposes the two
 * text models and only then the widget that is still holding them. Monaco notices and
 * throws "TextModel got disposed before DiffEditorWidget model got reset" — an uncaught
 * runtime error, not a warning, so it takes over the screen the moment the diff unmounts.
 *
 * It only shows up where a diff unmounts while the app keeps running, which is why the
 * desktop hit it first: there the commit view is a layer over the workspace, and closing
 * it unmounts the diff inside a live React tree. On the web the same screen is a browser
 * tab, and navigating away tears down the whole page before Monaco can complain — the
 * defect was always there, just unreachable.
 *
 * So `keepCurrentOriginalModel` / `keepCurrentModifiedModel` stop the library from
 * disposing anything, and this does it properly: release the models from the widget, then
 * dispose them. Skipping the disposal instead would leak a model pair per diff opened.
 *
 * ORDER-INDEPENDENT ON PURPOSE. Whether React runs this cleanup before or after the
 * library's is an implementation detail of how it walks a deleted subtree, and this must
 * not rest on it. Reached first, `setModel(null)` releases the models and the disposal is
 * clean. Reached second, the widget is already gone — `setModel` then throws on a disposed
 * object, which is why it is guarded, and the models still get disposed exactly once.
 */
function useDiffEditorTeardown() {
  const editorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null)

  useEffect(
    () => () => {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      editorRef.current = null

      // Read the models before touching the widget: after `setModel(null)` there is
      // nothing left to ask, and these are the objects that have to be disposed.
      const models = editor.getModel()

      try {
        editor.setModel(null)
      } catch {
        // Already disposed by the library's own cleanup. Nothing to release, and the
        // models below still need disposing.
      }

      models?.original.dispose()
      models?.modified.dispose()
    },
    [],
  )

  return editorRef
}

export function FileDiffView({ filePath, original, current, isDark }: FileDiffViewProps) {
  const editorRef = useDiffEditorTeardown()

  /**
   * One model pair per mounted view, and the SAME pair for every file it shows.
   *
   * Unique per instance because the library derives its model URI from these props and
   * defaults them to the empty string — so every diff editor in the app would otherwise
   * share one pair of models. That is reachable now: the commit view sits over a workspace
   * whose own diff tab may still be mounted underneath it.
   *
   * Stable across files because the library only creates a model when it cannot find one
   * at the URI, and hands back the existing one otherwise — with its old content. Keeping
   * the path fixed and letting the content props change means the library's own value sync
   * updates the text, instead of a new path resurrecting a stale model.
   */
  // Stripped to letters and digits: React's id is punctuated (`:r0:`), and a colon inside
  // the authority of `inmemory://…` reads as a port and makes the URI unparseable.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '')

  if (isGraphicalFile(filePath)) {
    return (
      <GraphicalDiffViewer originalContent={original} currentContent={current} filePath={filePath} isDark={isDark} />
    )
  }

  return (
    <DiffEditor
      original={formatContentForDisplay(filePath, original)}
      modified={formatContentForDisplay(filePath, current)}
      language={getLanguageFromPath(filePath)}
      theme={isDark ? 'vs-dark' : 'vs'}
      originalModelPath={`inmemory://diff${instanceId}/original`}
      modifiedModelPath={`inmemory://diff${instanceId}/modified`}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(editor) => {
        editorRef.current = editor
      }}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 12,
        scrollBeyondLastLine: false,
        domReadOnly: true,
        renderSideBySide: true,
        originalEditable: false,
      }}
    />
  )
}
