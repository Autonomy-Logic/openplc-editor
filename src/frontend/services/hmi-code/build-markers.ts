/**
 * Marks the HMI build's errors in a screen or widget block's code: at their line, or at the block name when they name
 * none or another file; an error another owner marks on that line is left out.
 */
import type * as monaco from 'monaco-editor'

import type { HmiDiagnostic } from '../../../middleware/shared/ports/hmi-preview-types'

const MARKER_OWNER = 'hmi-build'

/** The parts of a Monaco text model the markers are placed with. */
export type MarkedText = Pick<
  monaco.editor.ITextModel,
  'getValue' | 'getLineContent' | 'getLineMaxColumn' | 'getLineCount'
> & { getPositionAt(offset: number): monaco.IPosition }

/** Where the block's name is, or the first line when the code declares none. */
function nameRange(model: MarkedText): monaco.IRange {
  const match = /\bFUNCTION_BLOCK\s+(\w+)/i.exec(model.getValue())
  if (!match) return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: model.getLineMaxColumn(1) }
  const start = model.getPositionAt(match.index + match[0].length - match[1].length)
  const end = model.getPositionAt(match.index + match[0].length)
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  }
}

function lineRange(model: MarkedText, line: number): monaco.IRange {
  const text = model.getLineContent(line)
  const first = text.length - text.trimStart().length + 1
  return { startLineNumber: line, startColumn: first, endLineNumber: line, endColumn: model.getLineMaxColumn(line) }
}

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

/** The markers for `diagnostics` in the code of the file `fileName`, given the errors other owners mark there. */
export function hmiBuildMarkers(
  model: MarkedText,
  fileName: string,
  diagnostics: readonly HmiDiagnostic[],
  others: ReadonlyArray<Pick<monaco.editor.IMarker, 'startLineNumber' | 'message'>>,
  severity: monaco.MarkerSeverity,
): monaco.editor.IMarkerData[] {
  const markers: monaco.editor.IMarkerData[] = []
  for (const d of diagnostics) {
    const here = same(d.file, fileName) && d.line !== undefined && d.line >= 1 && d.line <= model.getLineCount()
    if (here && others.some((m) => m.startLineNumber === d.line && same(m.message, d.message))) continue
    const range = here && d.line !== undefined ? lineRange(model, d.line) : nameRange(model)
    const message = here ? d.message : `${d.file}${d.line !== undefined ? `:${d.line}` : ''}: ${d.message}`
    markers.push({ severity, message, source: 'HMI build', ...range })
  }
  return markers
}

/** Keeps the build's markers on `model` in step with `diagnostics()`, also when other owners' markers change. */
export function attachHmiBuildMarkers(
  api: typeof monaco,
  model: monaco.editor.ITextModel,
  fileName: string,
  diagnostics: () => readonly HmiDiagnostic[],
): { refresh(): void; dispose(): void } {
  let last = ''
  const refresh = (): void => {
    if (model.isDisposed()) return
    const others = api.editor
      .getModelMarkers({ resource: model.uri })
      .filter((m) => m.owner !== MARKER_OWNER && m.severity === api.MarkerSeverity.Error)
    const markers = hmiBuildMarkers(model, fileName, diagnostics(), others, api.MarkerSeverity.Error)
    const key = JSON.stringify(markers)
    if (key === last) return
    last = key
    api.editor.setModelMarkers(model, MARKER_OWNER, markers)
  }
  const changed = api.editor.onDidChangeMarkers((uris) => {
    if (uris.some((u) => u.toString() === model.uri.toString())) refresh()
  })
  refresh()
  return {
    refresh,
    dispose() {
      changed.dispose()
      if (!model.isDisposed()) api.editor.setModelMarkers(model, MARKER_OWNER, [])
    },
  }
}
