/**
 * FileDiffView — single entry point for rendering a before/after diff of one
 * project file. Routes graphical POUs (.ld/.fbd) to the GraphicalDiffViewer
 * and everything else to Monaco's DiffEditor. Shared by the history page and
 * the source-control diff tab so both surfaces render diffs identically.
 */

import { DiffEditor } from '@monaco-editor/react'

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

export function FileDiffView({ filePath, original, current, isDark }: FileDiffViewProps) {
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
