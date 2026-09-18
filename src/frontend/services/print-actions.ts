/**
 * Assemble a `PrintRequest` from the live project and drive the export-to-PDF
 * wizard's render + save steps (DOPE-594).
 *
 * `collectSelectedPous` walks `project.data.pous` in project-explorer order,
 * filters to the selection, and builds one `PrintPou` per POU: LD/FBD read
 * straight off the (freshly flushed) persisted flow, ST/IL/C++/Python get a
 * `ColoredLine[]` built here on the main thread (Monaco's static tokenizer
 * for IL/C++/Python; the STruC++ LSP's live semantic tokens for ST, which has
 * no Monarch tokenizer of its own — see `st-lsp/print-tokens-api.ts`). The
 * render itself (`ProjectPort.renderPdf`) and the colored-text assembly here
 * are deliberately split from the pure `backend/shared/print` engine: the
 * engine never imports Monaco/LSP/DOM, so it can run in a Worker.
 */

import * as monaco from 'monaco-editor'

import type { ColoredLine, PrintPou, PrintRequest, PrintVar, TextRun } from '../../middleware/shared/ports/print-types'
import type { ProjectPort } from '../../middleware/shared/ports/project-port'
import type {
  FBDRungState,
  PLCPou,
  PLCVariable,
  PouLanguage,
  RungLadderState,
} from '../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../store'
import { flushFlowWriteBacks } from '../store/slices/shared/flow-writeback'
import { OPENPLC_LIGHT_EDITOR_FOREGROUND, resolveOpenPlcTokenColor } from '../utils/monaco/openplc-theme-data'
import { toast } from '../utils/toast'
import { getPrintSemanticTokensApi } from './st-lsp'

function toPrintVars(variables: PLCVariable[]): PrintVar[] {
  return variables.map((v) => ({
    name: v.name,
    varClass: v.class ?? '',
    flag: v.flag ?? '',
    type: v.type.value,
    location: v.location,
    initialValue: v.initialValue ?? '',
    documentation: v.documentation,
    debug: v.debug ?? false,
  }))
}

function isLadderBody(value: unknown): value is { rungs: RungLadderState[] } {
  return typeof value === 'object' && value !== null && 'rungs' in value && Array.isArray(value.rungs)
}

function isFbdBody(value: unknown): value is { rung: FBDRungState } {
  return typeof value === 'object' && value !== null && 'rung' in value && typeof value.rung === 'object'
}

/** `monaco.editor.tokenize()` — synchronous, covers IL/C++/Python (no LSP overlay for any of the three). */
function coloredLinesFromMonarch(sourceText: string, languageId: string): ColoredLine[] {
  const lines = sourceText.split('\n')
  const tokenized = monaco.editor.tokenize(sourceText, languageId)
  return lines.map((text, i) => {
    const lineTokens = tokenized[i] ?? []
    const runs: TextRun[] = []
    for (let j = 0; j < lineTokens.length; j += 1) {
      const start = lineTokens[j].offset
      const end = j + 1 < lineTokens.length ? lineTokens[j + 1].offset : text.length
      if (end <= start) continue
      runs.push({ text: text.slice(start, end), color: resolveOpenPlcTokenColor(lineTokens[j].type) })
    }
    if (runs.length === 0) runs.push({ text, color: OPENPLC_LIGHT_EDITOR_FOREGROUND })
    return { runs }
  })
}

type DecodedToken = { line: number; col: number; len: number; typeIdx: number }

/** Decode delta-encoded LSP semantic tokens (already shifted to body-relative lines) into per-line runs. */
function decodeSemanticTokensToColoredLines(
  sourceLines: string[],
  legend: monaco.languages.SemanticTokensLegend,
  data: Uint32Array,
): ColoredLine[] {
  const tokens: DecodedToken[] = []
  let line = 0
  let col = 0
  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i]
    const deltaStart = data[i + 1]
    if (deltaLine === 0) col += deltaStart
    else {
      line += deltaLine
      col = deltaStart
    }
    tokens.push({ line, col, len: data[i + 2], typeIdx: data[i + 3] })
  }

  const byLine = new Map<number, DecodedToken[]>()
  for (const token of tokens) {
    const existing = byLine.get(token.line)
    if (existing) existing.push(token)
    else byLine.set(token.line, [token])
  }

  return sourceLines.map((text, lineIndex) => {
    const lineTokens = (byLine.get(lineIndex) ?? []).sort((a, b) => a.col - b.col)
    const runs: TextRun[] = []
    let cursor = 0
    for (const token of lineTokens) {
      if (token.col > cursor) runs.push({ text: text.slice(cursor, token.col), color: OPENPLC_LIGHT_EDITOR_FOREGROUND })
      const end = Math.min(token.col + token.len, text.length)
      runs.push({
        text: text.slice(token.col, end),
        color: resolveOpenPlcTokenColor(legend.tokenTypes[token.typeIdx] ?? ''),
      })
      cursor = end
    }
    if (cursor < text.length) runs.push({ text: text.slice(cursor), color: OPENPLC_LIGHT_EDITOR_FOREGROUND })
    if (runs.length === 0) runs.push({ text: '', color: OPENPLC_LIGHT_EDITOR_FOREGROUND })
    return { runs }
  })
}

/** ST has no Monarch tokenizer — the LSP semantic-tokens response is the only source of color, live editor included. */
async function coloredLinesForSt(pouName: string, sourceText: string): Promise<ColoredLine[]> {
  const lines = sourceText.split('\n')
  const api = getPrintSemanticTokensApi()
  const tokens = api ? await api.requestBodySemanticTokens(pouName) : null
  if (!tokens) return lines.map((text) => ({ runs: [{ text, color: OPENPLC_LIGHT_EDITOR_FOREGROUND }] }))
  return decodeSemanticTokensToColoredLines(lines, tokens.legend, tokens.data)
}

/**
 * The port-shape `PLCBody.language` field carries a broader union than the
 * runtime ever produces — see `export-actions.ts`'s identical narrowing cast,
 * the same invariant every other body-reading consumer already relies on.
 */
async function buildPrintPou(pou: PLCPou): Promise<PrintPou | null> {
  const variables = toPrintVars(pou.interface?.variables ?? [])
  const language = pou.body.language as PouLanguage

  switch (language) {
    case 'ld': {
      if (!isLadderBody(pou.body.value)) return null
      return { name: pou.name, kind: 'ld', rungs: pou.body.value.rungs, variables }
    }
    case 'fbd': {
      if (!isFbdBody(pou.body.value)) return null
      return { name: pou.name, kind: 'fbd', rung: pou.body.value.rung, variables }
    }
    case 'il':
    case 'cpp':
    case 'python': {
      const text = typeof pou.body.value === 'string' ? pou.body.value : ''
      return { name: pou.name, kind: language, lines: coloredLinesFromMonarch(text, language), variables }
    }
    case 'st': {
      const text = typeof pou.body.value === 'string' ? pou.body.value : ''
      return { name: pou.name, kind: 'st', lines: await coloredLinesForSt(pou.name, text), variables }
    }
    case 'sfc':
      // No SFC renderer in backend/shared/print — silently excluded from the export.
      return null
    default: {
      const exhaustive: never = language
      return exhaustive
    }
  }
}

/** Builds one `PrintPou` per selected POU, in `project.data.pous` order. Exported for tests. */
export async function collectSelectedPous(selectedNames: string[]): Promise<PrintPou[]> {
  const selected = new Set(selectedNames)
  const { project } = openPLCStoreBase.getState()
  const pous: PrintPou[] = []
  for (const pou of project.data.pous) {
    if (!selected.has(pou.name)) continue
    const printPou = await buildPrintPou(pou)
    if (printPou) pous.push(printPou)
  }
  return pous
}

/**
 * Render the current print selection to PDF bytes. Flushes pending
 * graphical write-backs first — printing a just-edited, still-debounced
 * LD/FBD POU must not show stale content (same requirement `save-actions.ts`
 * has for serialization).
 */
export async function renderPrintPdf(
  projectPort: ProjectPort,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const staleFlows = flushFlowWriteBacks(openPLCStoreBase.getState)
  if (staleFlows.length > 0) {
    return {
      ok: false,
      error: `The following POUs have unsaved changes that failed to validate and were not printed: ${staleFlows.join(', ')}.`,
    }
  }

  try {
    const { project, print } = openPLCStoreBase.getState()
    const pous = await collectSelectedPous(print.selectedPouNames)
    if (pous.length === 0) {
      return { ok: false, error: 'No printable POUs are selected.' }
    }

    const request: PrintRequest = {
      projectName: project.meta.name,
      mode: print.renderMode,
      pagePolicy: print.pagePolicy,
      page: {
        size: print.pageSetup.size,
        orientation: print.pageSetup.orientation,
        marginsPt: print.pageSetup.margins,
      },
      pous,
    }

    const bytes = await projectPort.renderPdf(request)
    return { ok: true, bytes }
  } catch (err) {
    console.error('[print] renderPrintPdf failed:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred while rendering the PDF.',
    }
  }
}

/** Persist already-rendered PDF bytes (the export wizard's final step — reuses the exact preview bytes). */
export async function executeExportPdf(projectPort: ProjectPort, bytes: Uint8Array): Promise<{ success: boolean }> {
  const { project } = openPLCStoreBase.getState()

  try {
    const fileName = `${project.meta.name}.pdf`
    const exportResult = await projectPort.exportPdfFile(fileName, bytes)

    if (exportResult.canceled) {
      return { success: false }
    }

    if (!exportResult.success) {
      toast({
        title: 'Error exporting PDF',
        description: exportResult.error ?? 'Failed to save the exported file.',
        variant: 'fail',
      })
      return { success: false }
    }

    toast({
      title: 'Project exported',
      description: `"${fileName}" was exported successfully.`,
      variant: 'default',
    })
    return { success: true }
  } catch (err) {
    toast({
      title: 'Error exporting PDF',
      description: err instanceof Error ? err.message : 'An unexpected error occurred while exporting.',
      variant: 'fail',
    })
    return { success: false }
  }
}
